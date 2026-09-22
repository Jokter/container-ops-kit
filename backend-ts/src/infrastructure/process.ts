import {spawn} from 'node:child_process';
import {access, mkdir, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, dirname, join} from 'node:path';

export interface ProcessResult {exitCode:number;output:string}
async function executable(name:string):Promise<string>{
  if(process.platform!=='win32'||/[./\\]/.test(name))return name;
  for(const dir of (process.env.PATH??'').split(delimiter))for(const ext of ['.cmd','.bat','.exe']){const path=join(dir.replaceAll('"',''),name+ext);try{await access(path,constants.X_OK);return path;}catch{/* next */}}
  return name;
}
export function isBatchFile(program:string,platform:NodeJS.Platform=process.platform):boolean{return platform==='win32'&&/\.(?:cmd|bat)$/i.test(program);}
export async function runProcess(command:readonly string[],directory:string,timeoutMs:number,logFile?:string,onLine:(line:string,stderr:boolean)=>boolean|void=()=>{},input?:string,signal?:AbortSignal):Promise<ProcessResult>{
  if(!command.length)throw new Error('命令不能为空');
  signal?.throwIfAborted();const program=await executable(command[0]!);signal?.throwIfAborted();let output='';let stopRequested=false;const captured=(line:string,stderr:boolean)=>{if(output.length<120000)output+=line+'\n';if(onLine(line,stderr))stopRequested=true;};
  return new Promise((resolve,reject)=>{
    const child=spawn(program,command.slice(1),{cwd:directory,windowsHide:true,detached:process.platform!=='win32',shell:isBatchFile(program),stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    let stopping:Promise<void>|undefined;let stopError:Error|undefined,stopCode:number|undefined;let settled=false;const terminate=()=>{if(stopping)return;if(process.platform==='win32'&&child.pid)stopping=new Promise(done=>{const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>done());killer.once('error',()=>done());});else if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};const record=(chunk:Buffer,stderr:boolean)=>{const key=stderr?1:0;buffers[key]+=chunk.toString('utf8');const split=buffers[key]!.split(/\r?\n/);buffers[key]=split.pop()??'';for(const line of split){captured(line,stderr);if(stopRequested){stopCode=0;terminate();break;}}};const buffers=['',''];
    const finish=async(error?:Error,code=255)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);for(let i=0;i<2;i++)if(buffers[i])captured(buffers[i]!,i===1);
      if(logFile){try{await mkdir(dirname(logFile),{recursive:true});await writeFile(logFile,output,'utf8');}catch{/* command result wins */}}
      await stopping;
      if(error)reject(error);else resolve({exitCode:code,output});};
    const abort=()=>{stopError=new Error('命令执行被中断');terminate();};signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{stopCode=124;terminate();},timeoutMs);
    child.stdout.on('data',(c:Buffer)=>record(c,false));child.stderr.on('data',(c:Buffer)=>record(c,true));child.once('error',error=>void finish(error));child.once('close',code=>void finish(stopError,stopCode??code??255));
    if(signal?.aborted)abort();
    if(input!=null)child.stdin.write(input);else child.stdin.end();
  });
}
