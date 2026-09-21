import {appendFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export type LogCategory='platform'|'build'|'deployment'|'auto-ut'|'quality'|'automation';
export interface LogSink{task(category:LogCategory,id:string,event:unknown):void}

const sensitive=/password|authorization|cookie|token|secret|privatekey|rootpassword/i;
function clean(value:unknown,key=''):unknown{
  if(key&&sensitive.test(key))return'[REDACTED]';
  if(Array.isArray(value))return value.map(item=>clean(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,clean(item,name)]));
  if(typeof value==='string')return value
    .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g,'://$1:[REDACTED]@')
    .replace(/(password|rootPassword|authorization|cookie|token|secret)\s*[:=]\s*([^\s,;}]+)/gi,'$1=[REDACTED]');
  return value;
}
function safe(value:string){return value.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,160)||'unknown';}

export class FileLogs implements LogSink{
  readonly root:string;
  constructor(root=process.env.PLATFORM_LOG_DIR?.trim()||'data/logs'){this.root=resolve(root);mkdirSync(this.root,{recursive:true});}
  task(category:LogCategory,id:string,event:unknown){this.append(resolve(this.root,category,`${safe(id)}.jsonl`),JSON.stringify(clean(event))+'\n');}
  backendStream(){return{write:(message:string)=>{process.stdout.write(message);let output=message;try{output=JSON.stringify(clean(JSON.parse(message)))+'\n';}catch{output=String(clean(message));}this.append(resolve(this.root,'backend','backend.jsonl'),output);}};}
  detailPath(category:LogCategory,id:string,name:string){const path=resolve(this.root,category,safe(id),'details',safe(name));mkdirSync(dirname(path),{recursive:true});return path;}
  private append(path:string,text:string){try{mkdirSync(dirname(path),{recursive:true});appendFileSync(path,text,'utf8');}catch(error){process.stderr.write(`[file-log] ${error instanceof Error?error.message:String(error)}\n`);}}
}

export const noFileLogs:LogSink={task:()=>{}};
