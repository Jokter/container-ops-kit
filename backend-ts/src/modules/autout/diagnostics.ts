import {appendFileSync,mkdirSync} from 'node:fs';
import {dirname,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runProcess} from '../../infrastructure/process.js';

export function redactDiagnostic(text:string){
 let safe=text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=_.-]+/gi,'$1 [REDACTED]')
  .replace(/((?:["']?(?:_authToken|_auth|password|authorization|cookie|token|secret)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1[REDACTED]');
 for(const [name,value]of Object.entries(process.env))if(/(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|API_KEY)/i.test(name)&&value&&value.length>=6)safe=safe.split(value).join('[REDACTED]');
 return safe;
}
export function redactJsonDiagnostic(text:string){
 try{return JSON.stringify(JSON.parse(text), (key,value:unknown)=>/^(?:_authToken|_auth|password|authorization|cookie|token|secret)$/i.test(key)?'[REDACTED]':typeof value==='string'?redactDiagnostic(value):value,2);}
 catch{return redactDiagnostic(text);}
}
export function diagnosticEvent(directory:string,event:Record<string,unknown>){
 try{mkdirSync(directory,{recursive:true});appendFileSync(join(directory,'diagnostics.jsonl'),JSON.stringify({...event,time:new Date().toISOString()},(_key,value:unknown)=>typeof value==='string'?redactDiagnostic(value):value)+'\n');}
 catch{process.stderr.write('[auto-ut] 无法写入诊断日志，请检查日志目录权限和磁盘空间。\n');}
}
export async function runLoggedProcess(command:readonly string[],directory:string,timeoutMs:number,logFile:string,onLine:(line:string,stderr:boolean)=>boolean|void=()=>{},input?:string,signal?:AbortSignal,context:Record<string,unknown>={}){
 const operationId=randomUUID(),root=dirname(logFile),outputFile=basename(logFile,'.log')+'-'+operationId+'.log',started=Date.now();let logFailed=false;
 const event=(data:Record<string,unknown>)=>diagnosticEvent(root,{...context,operationId,...data});
 event({type:'command_start',command,directory,timeoutMs,outputFile,node:process.version,platform:process.platform});
 try{
  const result=await runProcess(command,directory,timeoutMs,undefined,(line,stderr)=>{
   if(!logFailed)try{appendFileSync(join(root,outputFile),`${new Date().toISOString()} ${stderr?'stderr':'stdout'} ${redactDiagnostic(line)}\n`);}catch{logFailed=true;event({type:'log_write_failed',outputFile});}
   return onLine(line,stderr);
  },input,signal);
  event({type:'command_end',exitCode:result.exitCode,timedOut:result.exitCode===124,durationMs:Date.now()-started,outputChars:result.outputChars,captureTruncated:result.outputTruncated,logFailed});return result;
 }catch(error){event({type:'command_error',durationMs:Date.now()-started,aborted:signal?.aborted??false,error:error instanceof Error?error.message:String(error),logFailed});throw error;}
}
