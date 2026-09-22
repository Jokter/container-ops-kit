// Runs on the build host using Python's standard library; never extracts archives.
export const remoteResultsScript = String.raw`
import os, sys, json, re, tarfile, hashlib, difflib, tempfile, shutil, pathlib, signal
args=json.loads(sys.argv[1])
def cancelled(signum,frame): raise RuntimeError('下载或读取已取消')
for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP): signal.signal(sig,cancelled)
MAX_FILE=512*1024*1024
MAX_TOTAL=2*1024*1024*1024
MAX_TEXT=256*1024
budget=[0]
preview_budget=[2*1024*1024]
def check_path(root,path):
    if os.path.commonpath([os.path.realpath(root),os.path.realpath(path)])!=os.path.realpath(root):
        raise ValueError('产物路径越界')
    if os.path.islink(path): raise ValueError('产物包含符号链接，无法处理')
    return path
def metadata(text,key,fallback):
    m=re.search(r'^'+key+r':\s*[\'"]?([^\s\'"#]+)',text,re.M)
    return m.group(1) if m else fallback
def valid_name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,199}',value): raise ValueError('服务名称不合法')
    return value
def archive_members(path):
    with tarfile.open(path,'r:gz') as tf:
        members=tf.getmembers()
        if len(members)>100000: raise ValueError('包内文件数量超出限制')
        names=set()
        for m in members:
            parts=pathlib.PurePosixPath(m.name).parts
            if not parts or m.name.startswith('/') or '..' in parts or '\\' in m.name or any(ord(c)<32 for c in m.name): raise ValueError('包内路径不合法')
            if not (m.isfile() or m.isdir()): raise ValueError('包内存在链接或特殊文件')
            if m.name in names: raise ValueError('包内存在重复路径')
            names.add(m.name)
            if m.size>MAX_FILE: raise ValueError('包内文件过大')
        charts=[m for m in members if m.isfile() and m.name.endswith('/Chart.yaml') and len(pathlib.PurePosixPath(m.name).parts)==2]
        if len(charts)!=1: raise ValueError('服务包必须包含一个顶层 Chart.yaml')
        chart=charts[0]
        if chart.size>MAX_TEXT: raise ValueError('Chart.yaml 过大')
        prefix=chart.name.rsplit('/',1)[0]+'/'
        if any(m.isfile() and not m.name.startswith(prefix) for m in members): raise ValueError('服务包内存在 Chart 目录外的文件')
        text=tf.extractfile(chart).read().decode('utf-8')
        return prefix,text

def discover(root):
    if not os.path.isdir(root): raise ValueError('构建产物目录不存在，可能已被清理')
    result={}
    for name in sorted(os.listdir(root)):
        path=check_path(root,os.path.join(root,name))
        if os.path.isdir(path) and os.path.isfile(os.path.join(path,'Chart.yaml')):
            chart=check_path(root,os.path.join(path,'Chart.yaml'))
            if os.path.getsize(chart)>MAX_TEXT: raise ValueError('Chart.yaml 过大')
            with open(chart,encoding='utf-8') as f: text=f.read()
            service=valid_name(metadata(text,'name',name))
            size=0
            for base,dirs,files in os.walk(path,followlinks=False):
                for entry in dirs+files:
                    p=check_path(root,os.path.join(base,entry))
                    if os.path.isfile(p): size+=os.path.getsize(p)
            if service in result: raise ValueError('存在重复服务目录：'+service)
            result[service]={'service':service,'path':path,'kind':'directory','filename':service+'.tgz','size':size,'version':metadata(text,'version','—')}
    archives=set()
    for name in sorted(os.listdir(root)):
        if not name.endswith(('.tgz','.tar.gz')): continue
        path=check_path(root,os.path.join(root,name))
        if not os.path.isfile(path): continue
        prefix,text=archive_members(path)
        service=valid_name(metadata(text,'name',prefix.rstrip('/')))
        if service in archives: raise ValueError('服务存在多个构建包：'+service)
        archives.add(service)
        result[service]={'service':service,'path':path,'kind':'archive','filename':name,'size':os.path.getsize(path),'version':metadata(text,'version','—')}
    if len(result)>1000: raise ValueError('服务数量超出限制')
    return result

def digest(stream,size):
    budget[0]+=size
    if size>MAX_FILE or budget[0]>MAX_TOTAL: raise ValueError('产物内容超出对比容量限制')
    h=hashlib.sha256(); data=bytearray()
    while True:
        block=stream.read(1024*1024)
        if not block: break
        h.update(block)
        if size<=MAX_TEXT: data.extend(block)
    text=None
    if size<=MAX_TEXT and b'\x00' not in data:
        try: text=data.decode('utf-8')
        except UnicodeDecodeError: pass
    return {'hash':h.hexdigest(),'size':size,'text':text}

def contents(entry):
    result={}; path=entry['path']
    if entry['kind']=='archive':
        prefix,_=archive_members(path)
        with tarfile.open(path,'r:gz') as tf:
            for m in tf:
                if m.isfile():
                    with tf.extractfile(m) as stream: result[m.name[len(prefix):]]=digest(stream,m.size)
    else:
        for base,dirs,files in os.walk(path,followlinks=False):
            dirs.sort()
            for name in dirs: check_path(path,os.path.join(base,name))
            for name in sorted(files):
                p=check_path(path,os.path.join(base,name))
                if not os.path.isfile(p): raise ValueError('产物包含特殊文件')
                with open(p,'rb') as stream: result[os.path.relpath(p,path)]=digest(stream,os.path.getsize(p))
                if len(result)>100000: raise ValueError('文件数量超出限制')
    return result

def public(entry): return {k:entry[k] for k in ['service','kind','filename','size','version']}
def differences(a,b):
    results=[]
    for name in sorted(set(a)|set(b)):
        left=contents(a[name]) if name in a else {}; right=contents(b[name]) if name in b else {}; files=[]
        for path in sorted(set(left)|set(right)):
            x=left.get(path);y=right.get(path)
            if x and y and x['hash']==y['hash']: continue
            status='ADDED' if x is None else 'REMOVED' if y is None else 'MODIFIED'
            binary=bool((x and x['text'] is None) or (y and y['text'] is None))
            patch=''; truncated=False
            if not binary:
                source=difflib.unified_diff((x['text'] if x else '').splitlines(keepends=True),(y['text'] if y else '').splitlines(keepends=True),fromfile='A/'+path,tofile='B/'+path)
                pieces=[]; length=0
                for line in source:
                    if length+len(line)>min(64000,preview_budget[0]): truncated=True;break
                    pieces.append(line if line.endswith('\n') else line+'\n');length+=len(line)
                patch=''.join(pieces);preview_budget[0]-=length
            files.append({'path':path,'status':status,'binary':binary,'truncated':truncated,'patch':patch,'beforeBytes':x['size'] if x else None,'afterBytes':y['size'] if y else None})
        status='ADDED' if name not in a else 'REMOVED' if name not in b else 'MODIFIED' if files else 'UNCHANGED'
        if sum(len(s['files']) for s in results)+len(files)>20000: raise ValueError('变化文件数量超出限制')
        results.append({'service':name,'status':status,'baseline':public(a[name]) if name in a else None,'candidate':public(b[name]) if name in b else None,'files':files})
    return results

def package(entry,destination):
    if entry['kind']=='archive':
        archive_members(entry['path'])
        shutil.copyfile(entry['path'],destination)
    else:
        root=entry['path']
        def safe(info):
            if not(info.isfile() or info.isdir()): raise ValueError('产物包含链接或特殊文件')
            return info
        with tarfile.open(destination,'w:gz') as tf: tf.add(root,arcname=entry['service'],filter=safe)

try:
    roots=args['roots']
    boundary=args.get('boundary')
    if boundary:
        for root in roots:
            if os.path.commonpath([os.path.realpath(boundary),os.path.realpath(root)])!=os.path.realpath(boundary): raise ValueError('产物目录越界')
            current=root
            while current!=boundary:
                if os.path.islink(current): raise ValueError('产物目录包含符号链接')
                parent=os.path.dirname(current)
                if parent==current: raise ValueError('产物目录不合法')
                current=parent
    catalogs=[discover(r) for r in roots]
    if args['action']=='inspect':
        output={'packages':[public(e) for e in catalogs[0].values()],'comparison':None}
        if len(catalogs)==2: output={'packages':[],'comparison':differences(catalogs[0],catalogs[1])}
        print(json.dumps(output,ensure_ascii=True))
    elif args['action']=='download':
        names=args['services']
        if not names or len(names)>100 or len(set(names))!=len(names): raise ValueError('下载服务数量不合法')
        entries=[catalogs[0][valid_name(n)] for n in names]
        with tempfile.TemporaryDirectory(prefix='container-ops-download-') as temp:
            paths=[]
            for entry in entries:
                path=os.path.join(temp,entry['service']+'.tgz');package(entry,path);paths.append((entry,path))
            if len(paths)==1:
                with open(paths[0][1],'rb') as source: shutil.copyfileobj(source,sys.stdout.buffer)
            else:
                with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as tf:
                    for entry,path in paths: tf.add(path,arcname=entry['service']+'/'+entry['filename'],recursive=False)
except Exception as error:
    print('构建产物处理失败：'+str(error),file=sys.stderr);sys.exit(2)
`;
