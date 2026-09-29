import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,resolve} from 'node:path';
import {currentWorkspace,processEnvironment} from '../auth/workspace.js';

const execute=promisify(execFile);
type RuntimePaths={UV_CACHE_DIR:string;UV_PYTHON_INSTALL_DIR:string};
type Probe=(args:readonly string[])=>Promise<string>;
export class UvRuntimeError extends Error{}
// Ask uv itself for machine-level runtime locations rather than guessing OS-specific defaults.
// No network calls, installs, credentials or user CLI homes are shared by this lookup.
export async function discoverUvRuntime(env:NodeJS.ProcessEnv,probe:Probe):Promise<RuntimePaths>{
 const directory=async(key:keyof RuntimePaths,args:readonly string[])=>{
  const explicit=env[key]?.trim();if(explicit)return resolve(explicit);
  try{const value=(await probe(args)).trim();if(!value||/[\r\n\0]/.test(value)||!isAbsolute(value))throw Error();return value;}
  catch{throw new UvRuntimeError(`无法读取机器上的 ${key}，请确认 uv 已安装，或在启动后端前显式设置 UV_CACHE_DIR 和 UV_PYTHON_INSTALL_DIR`);}
 };
 const [cache,python]=await Promise.all([directory('UV_CACHE_DIR',['cache','dir']),directory('UV_PYTHON_INSTALL_DIR',['python','dir'])]);
 return {UV_CACHE_DIR:cache,UV_PYTHON_INSTALL_DIR:python};
}
let runtime:Promise<RuntimePaths>|undefined;
function machineRuntime(){
 if(!runtime){const env={...process.env};for(const key of ['WELINK_TOKEN','CODEHUB_TOKEN','DTS_TOKEN'])delete env[key];
  const pending=discoverUvRuntime(env,async args=>{const result=await execute(process.platform==='win32'?'uv.exe':'uv',[...args],{env:{...env,NO_COLOR:'1'},windowsHide:true,timeout:5000,maxBuffer:16384,encoding:'utf8'});return result.stdout;});
  runtime=pending;void pending.catch(()=>{if(runtime===pending)runtime=undefined;});
 }
 return runtime;
}
export async function welinkMcpEnvironment(load:()=>Promise<RuntimePaths>=machineRuntime):Promise<NodeJS.ProcessEnv>{
 const env=processEnvironment();if(!currentWorkspace())return env;
 return {...env,...await load()};
}
