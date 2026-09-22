import './build-results.css'

export function createBuildResults({request,render,toast,escapeHtml}) {
  const ui={id:'',task:null,result:null,error:'',loading:false,query:'',filter:'ALL',selected:new Set(),service:'',file:'',downloading:false,generation:0}
  const labels={ADDED:'新增',REMOVED:'删除',MODIFIED:'修改',UNCHANGED:'无差异'}
  const colors={ADDED:'green',REMOVED:'red',MODIFIED:'amber',UNCHANGED:''}
  const esc=escapeHtml
  const size=n=>n==null?'—':n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'
  const badge=s=>`<span class="badge ${colors[s]||''}">${labels[s]||s}</span>`
  const selectedTask=()=>ui.task
  const matches=row=>row.service.toLowerCase().includes(ui.query.toLowerCase())
  const services=()=> (ui.result?.comparison||[]).filter(row=>matches(row)&&(ui.filter==='ALL'||ui.filter==='CHANGED'&&row.status!=='UNCHANGED'||row.status===ui.filter))
  const packages=()=> (ui.result?.packages||[]).filter(matches)
  async function load(task,force=false){
    if(task.status!=='SUCCEEDED')return
    if(ui.id!==task.id){ui.id=task.id;ui.task=task;ui.result=null;ui.error='';ui.loading=false;ui.query='';ui.filter='ALL';ui.selected.clear();ui.service='';ui.file='';ui.generation++}
    ui.task=task
    if(ui.loading||!force&&(ui.result||ui.error))return
    ui.loading=true;ui.error='';const generation=++ui.generation
    try{const result=await request(`/api/build-tasks/${task.id}/results`);if(generation!==ui.generation)return;ui.result=result;ui.service=result.comparison?.[0]?.service||'';ui.file=''}
    catch(error){if(generation===ui.generation)ui.error=error.message||'读取构建产物失败'}
    finally{if(generation===ui.generation){ui.loading=false;render(false)}}
  }
  function detail(){
    const rows=services();let row=rows.find(r=>r.service===ui.service)||rows[0]
    if(!row)return '<div class="br-empty">请选择服务查看差异</div>'
    ui.service=row.service
    const file=row.files.find(f=>f.path===ui.file)||row.files[0]
    const downloads=['baseline','candidate'].filter(side=>row[side]).map(side=>`<button class="qw-link" data-br-download="${esc(row.service)}" data-br-side="${side}" ${ui.downloading?'disabled':''}>↓ 下载 ${side==='baseline'?'A':'B'} 包</button>`).join('')
    let content='<div class="br-empty">✓ 两边包内文件内容一致</div>'
    if(file){ui.file=file.path;const patch=file.patch.split('\n').map(line=>`<div class="br-code-line ${line.startsWith('+')&&!line.startsWith('+++')?'br-add':line.startsWith('-')&&!line.startsWith('---')?'br-del':''}">${esc(line)||' '}</div>`).join('')
      content=`<div class="br-files">${row.files.map(f=>`<button data-br-file="${esc(f.path)}" class="${f.path===file.path?'active':''}">${esc(f.path)} ${badge(f.status)}</button>`).join('')}</div><div class="br-diff-caption"><span>${esc(file.path)}</span><span>− A 基准 / + B 验证</span></div>${file.binary?`<div class="br-empty">二进制文件或超过 256 KB 的文本，内容已变化。<br>A：${size(file.beforeBytes)} → B：${size(file.afterBytes)}<br>请下载构建包查看完整内容。</div>`:`<div class="br-code">${patch||'<div class="br-empty">空文件变化</div>'}</div>`}${file.truncated?'<p class="br-warning">差异预览已截断，请下载 A / B 包查看完整文件。</p>':''}`
    }
    return `<div class="br-detail-head"><strong>${esc(row.service)}</strong> ${badge(row.status)}<p>${row.files.length} 个变化文件</p></div>${content}<div class="br-diff-actions">${downloads}</div>`
  }
  function html(task){
    if(task.status!=='SUCCEEDED')return ''
    void load(task)
    const head=`<div class="panel-head"><div><h2>${task.mode==='SINGLE'?'服务构建包':'产物差异'}</h2><p class="br-sub">${task.mode==='SINGLE'?'按服务下载；已有压缩包保留原包，目录按服务打包。':'以 A 为基准，按服务查看 B 的包内文件变化。'}</p></div>${task.mode==='COMPARE'&&ui.result?'<button class="button small" data-br-export>导出报告</button>':''}</div>`
    if(ui.loading)return `<section class="panel br-results">${head}<div class="br-empty">正在读取构建产物${task.mode==='COMPARE'?'与文件差异':''}…</div></section>`
    if(ui.error)return `<section class="panel br-results">${head}<div class="br-empty" role="alert">${esc(ui.error)}<br><button class="button small" data-br-retry>重新读取</button></div></section>`
    if(!ui.result)return ''
    const search=`<input id="br-search" aria-label="搜索服务" placeholder="搜索服务名称" value="${esc(ui.query)}">`
    if(task.mode==='SINGLE'){
      const rows=packages();const all=rows.length&&rows.every(r=>ui.selected.has(r.service))
      return `<section class="panel br-results">${head}<div class="br-toolbar">${search}<span class="br-spacer"></span><span class="br-sub">已选择 ${ui.selected.size} 项</span><button class="button primary small" data-br-batch ${!ui.selected.size||ui.downloading?'disabled':''}>${ui.downloading?'下载中…':'下载所选'}</button></div><div class="br-table-wrap"><table class="br-table"><thead><tr><th><input type="checkbox" data-br-all aria-label="选择当前列表全部服务" ${all?'checked':''}></th><th>服务 / 构建包</th><th>版本</th><th>大小</th><th>操作</th></tr></thead><tbody>${rows.map(row=>`<tr><td><input type="checkbox" data-br-check="${esc(row.service)}" aria-label="选择 ${esc(row.service)}" ${ui.selected.has(row.service)?'checked':''}></td><td><strong>${esc(row.service)}</strong><small>${esc(row.filename)}${row.kind==='directory'?' · 下载时打包':''}</small></td><td>${esc(row.version)}</td><td>${size(row.size)}${row.kind==='directory'?'<small>目录原始大小</small>':''}</td><td><button class="qw-link" data-br-download="${esc(row.service)}" data-br-side="single" ${ui.downloading?'disabled':''}>↓ 下载包</button></td></tr>`).join('')||'<tr><td colspan="5" class="br-empty">没有可显示的服务构建包</td></tr>'}</tbody></table></div><div class="br-foot">显示 ${rows.length} / ${ui.result.packages.length} 个服务 · 批量下载将打包为一个 .tar.gz 文件，内含各服务包。</div></section>`
    }
    const rows=services(),all=ui.result.comparison||[]
    return `<section class="panel br-results">${head}<div class="br-stats"><span><strong>${all.length}</strong> 服务</span>${Object.entries(labels).map(([key,label])=>`<span><strong class="br-${key.toLowerCase()}">${all.filter(r=>r.status===key).length}</strong> ${label}</span>`).join('')}</div><div class="br-toolbar">${search}<div class="br-filters">${Object.entries({ALL:'全部',CHANGED:'仅差异',...labels}).map(([key,label])=>`<button data-br-filter="${key}" class="${key===ui.filter?'active':''}">${label}</button>`).join('')}</div></div><div class="br-layout"><div class="br-table-wrap"><table class="br-table"><thead><tr><th>服务</th><th>变化</th><th>文件</th></tr></thead><tbody>${rows.map(row=>`<tr class="${ui.service===row.service?'br-selected':''}"><td><button class="qw-link" data-br-service="${esc(row.service)}">${esc(row.service)}</button></td><td>${badge(row.status)}</td><td>${row.files.length||'—'}</td></tr>`).join('')||'<tr><td colspan="3" class="br-empty">没有符合条件的服务</td></tr>'}</tbody></table></div><div class="br-detail">${detail()}</div></div><div class="br-foot"><span>显示 ${rows.length} 个服务</span><span>A：${esc(task.baseline.archDesignBranch)} → B：${esc(task.candidate?.archDesignBranch||'')}</span></div></section>`
  }
  async function download(names,side){
    if(ui.downloading)return
    if(names.length>100){toast('单次最多下载 100 个服务，请减少选择');return}
    const task=selectedTask();if(!task)return
    ui.downloading=true;render(false)
    try{
      const params=new URLSearchParams({side,services:names.join(',')})
      const response=await fetch(`/api/build-tasks/${task.id}/packages?${params}`)
      if(!response.ok){const error=await response.json().catch(()=>({message:'下载失败'}));throw new Error(error.message||'下载失败')}
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;const disposition=response.headers.get('Content-Disposition')||''
      a.download=disposition.includes("filename*=UTF-8''")?decodeURIComponent(disposition.split("filename*=UTF-8''")[1]):'build-packages.tar.gz'
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('构建包已下载')
    }catch(error){toast(error.message||'下载失败')}finally{ui.downloading=false;render(false)}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-br-download],[data-br-batch],[data-br-filter],[data-br-service],[data-br-file],[data-br-retry],[data-br-export]');if(!button)return
    if(button.dataset.brDownload!==undefined){void download([button.dataset.brDownload],button.dataset.brSide);return}
    if(button.hasAttribute('data-br-batch')){void download([...ui.selected],'single');return}
    if(button.hasAttribute('data-br-retry')){void load(ui.task,true);render(false);return}
    if(button.hasAttribute('data-br-export')){const a=document.createElement('a');a.href=`/api/build-tasks/${ui.id}/diff-report`;a.download=`build-diff-${ui.id}.json`;document.body.append(a);a.click();a.remove();return}
    if(button.dataset.brFilter){ui.filter=button.dataset.brFilter;ui.service=services()[0]?.service||'';ui.file=''}
    if(button.dataset.brService){ui.service=button.dataset.brService;ui.file=''}
    if(button.dataset.brFile)ui.file=button.dataset.brFile
    render(false)
  })
  document.addEventListener('input',event=>{if(event.target.id!=='br-search')return;ui.query=event.target.value;const cursor=event.target.selectionStart;ui.service=services()[0]?.service||'';ui.file='';render(false);const input=document.getElementById('br-search');input?.focus();input?.setSelectionRange(cursor,cursor)})
  document.addEventListener('change',event=>{const name=event.target.dataset.brCheck;if(name!==undefined){event.target.checked?ui.selected.add(name):ui.selected.delete(name);render(false)}if(event.target.hasAttribute('data-br-all')){packages().forEach(row=>event.target.checked?ui.selected.add(row.service):ui.selected.delete(row.service));render(false)}})
  return {html,load}
}
