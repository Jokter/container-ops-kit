import {StringDecoder} from 'node:string_decoder';
import {spawn} from 'node:child_process';
import {access, mkdir, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, dirname, join} from 'node:path';

export interface ProcessResult {exitCode:number;output:string;outputTruncated?:boolean;outputChars?:number}
async function executable(name:string):Promise<string>{
  if(process.platform!=='win32'||/[./\\]/.test(name))return name;
  for(const dir of (process.env.PATH??'').split(delimiter))for(const ext of ['.cmd','.bat','.exe']){const path=join(dir.replaceAll('"',''),name+ext);try{await access(path,constants.X_OK);return path;}catch{/* next */}}
  return name;
}
export function isBatchFile(program:string,platform:NodeJS.Platform=process.platform):boolean{return platform==='win32'&&/\.(?:cmd|bat)$/i.test(program);}
// Windows argv quoting followed by cmd metacharacter escaping.
// Local npm .bin shims require a second escape pass (cross-spawn convention).
const cmdMeta=/([()\[\]%!^"`<>&|;, *?])/g;
export function batchArgument(value:string,doubleEscape=false):string {
 if(/[\r\n\0]/.test(value))throw Error('Windows 批处理参数不能包含换行或空字符');
 const quoted='"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
 const escaped=quoted.replace(cmdMeta,'^$1');
 return doubleEscape?escaped.replace(cmdMeta,'^$1'):escaped;
}
export function batchCommand(program:string,args:readonly string[]):string {
 if(/[\r\n\0]/.test(program))throw Error('无效的批处理路径');
 return '"'+program.replace(cmdMeta,'^$1')+' '+args.map(arg=>batchArgument(arg,/node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i.test(program))).join(' ')+'"';
}
export function displayCommand(command:readonly string[]):string {
 return command.map((arg,index)=>command[index-1]==='--text'||/[\s"&|<>]/.test(arg)?JSON.stringify(arg):arg).join(' ');
}
export async function runProcess(command:readonly string[],directory:string,timeoutMs:number,logFile?:string,onLine:(line:string,stderr:boolean)=>boolean|void=()=>{},input?:string,signal?:AbortSignal,maxCaptureChars=120000):Promise<ProcessResult>{
  if(!command.length)throw new Error('命令不能为空');
  signal?.throwIfAborted();const program=await executable(command[0]!);signal?.throwIfAborted();let output='',outputChars=0;let stopRequested=false;const captured=(line:string,stderr:boolean)=>{const text=line+'\n';outputChars+=text.length;output+=text.slice(0,Math.max(0,maxCaptureChars-output.length));if(onLine(line,stderr))stopRequested=true;};
  return new Promise((resolve,reject)=>{
    const batch=isBatchFile(program);
    const child=spawn(batch?(process.env.ComSpec||'cmd.exe'):program,batch?['/d','/s','/v:off','/c',batchCommand(program,command.slice(1))]:command.slice(1),{cwd:directory,windowsHide:true,detached:process.platform!=='win32',shell:false,windowsVerbatimArguments:batch,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    let stopping:Promise<void>|undefined;let stopError:Error|undefined,stopCode:number|undefined;let settled=false;const terminate=()=>{if(stopping)return;if(process.platform==='win32'&&child.pid)stopping=new Promise(done=>{const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>done());killer.once('error',()=>done());});else if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};const record=(chunk:Buffer,stderr:boolean)=>{const key=stderr?1:0;buffers[key]+=decoders[key]!.write(chunk);const split=buffers[key]!.split(/\r?\n/);buffers[key]=split.pop()??'';for(const line of split){captured(line,stderr);if(stopRequested){stopCode=0;terminate();break;}}};const buffers=['',''];const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')];
    const finish=async(error?:Error,code=255)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);for(let i=0;i<2;i++){buffers[i]+=decoders[i]!.end();if(buffers[i])captured(buffers[i]!,i===1);}
      if(logFile){try{await mkdir(dirname(logFile),{recursive:true});await writeFile(logFile,output,'utf8');}catch{/* command result wins */}}
      await stopping;
      if(error)reject(error);else resolve({exitCode:code,output,outputTruncated:outputChars>output.length,outputChars});};
    const abort=()=>{stopError=new Error('命令执行被中断');terminate();};signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{stopCode=124;terminate();},timeoutMs);
    child.stdout.on('data',(c:Buffer)=>record(c,false));child.stderr.on('data',(c:Buffer)=>record(c,true));child.once('error',error=>void finish(error));child.once('close',code=>void finish(stopError,stopCode??code??255));
    if(signal?.aborted)abort();
    if(input!=null)child.stdin.write(input);else child.stdin.end();
  });
}
