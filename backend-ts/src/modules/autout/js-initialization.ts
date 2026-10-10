import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import {jsGeneratedFile,utTestFile} from './languages.js';

export type JsInitialization=Record<string,{hash:string;testContent?:string}>;
export function statusPath(line:string):string {
 const value=line.slice(3);return (value.startsWith('"')?JSON.parse(value) as string:value).replaceAll('\\','/');
}
async function content(workspace:string,path:string){
 const file=resolve(workspace,path),root=await realpath(workspace),actual=await realpath(file);
 if(isAbsolute(relative(root,actual))||relative(root,actual).startsWith('..')||!(await lstat(file)).isFile())throw Error('初始化文件路径不安全：'+path);
 return readFile(file);
}
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export async function captureJsInitialization(workspace:string,status:string):Promise<JsInitialization>{
 const snapshot:JsInitialization={};
 for(const line of status.split(/\r?\n/).filter(line=>line.length>=4)){
  const path=statusPath(line);
  if(line.startsWith('?? ')&&jsGeneratedFile(path))continue;
  if(!path.startsWith('website/')||!(line.startsWith('?? ')||line.startsWith(' M ')))throw Error('初始化产生了目录外、删除或暂存修改，请人工检查：'+path);
  if(utTestFile(path,'JS')&&!line.startsWith('?? '))throw Error('初始化修改了已有测试，请人工检查：'+path);
  const value=await content(workspace,path);
  snapshot[path]={hash:hash(value),...(utTestFile(path,'JS')?{testContent:value.toString('utf8')}:{})};
 }
 return snapshot;
}
export async function filterJsInitialization(workspace:string,status:string,snapshot:JsInitialization={}):Promise<string>{
 // Check non-test files even if they disappeared from git status (e.g. restored
 // to HEAD); generated configuration must stay identical to the tested baseline.
 for(const [path,entry]of Object.entries(snapshot))if(!utTestFile(path,'JS')){
  try{if(hash(await content(workspace,path))!==entry.hash)throw Error();}
  catch{throw Error('初始化后非测试文件发生变化，已保留现场：'+path);}
 }
 const rows:string[]=[];
 for(const line of status.split(/\r?\n/).filter(line=>line.length>=4)){
  const path=statusPath(line);
  if(line.startsWith('?? ')&&jsGeneratedFile(path))continue;
  const entry=snapshot[path];
  // Never hide staged changes, deletions or renames.
  if(entry&&(line.startsWith('?? ')||entry.testContent===undefined&&line.startsWith(' M '))&&hash(await content(workspace,path))===entry.hash)continue;
  rows.push(line);
 }
 return rows.join('\n');
}
