import {stat} from 'node:fs/promises';
import {win32} from 'node:path';

const isFile=async(path:string)=>{try{return(await stat(path)).isFile();}catch{return false;}};
export function gitBashCandidates(env:NodeJS.ProcessEnv):string[]{
 const dirs=(env.PATH??env.Path??'').split(';').map(dir=>dir.trim().replace(/^"|"$/g,'')).filter(Boolean);
 const roots=[...dirs.flatMap(dir=>[dir,win32.resolve(dir,'..')]),...['ProgramFiles','ProgramFiles(x86)','LOCALAPPDATA'].flatMap(key=>env[key]?[win32.join(env[key]!,key==='LOCALAPPDATA'?'Programs/Git':'Git')]:[])];
 return [...new Set(roots.flatMap(root=>[win32.join(root,'bin','bash.exe'),win32.join(root,'usr','bin','bash.exe')]))];
}
export async function findGitBash(env:NodeJS.ProcessEnv=process.env,exists:(path:string)=>Promise<boolean>=isFile):Promise<string>{
 const configured=env.AUTO_UT_GIT_BASH?.trim();
 if(configured){
  if(!win32.isAbsolute(configured)||win32.basename(configured).toLowerCase()!=='bash.exe'||!await exists(configured))throw Error('AUTO_UT_GIT_BASH 必须指向已安装 Git for Windows 的 bash.exe 绝对路径。');
  return configured;
 }
 for(const path of gitBashCandidates(env))if(await exists(path))return path;
 throw Error('未找到 Git Bash，JS UT 需要 Git for Windows；请安装或设置 AUTO_UT_GIT_BASH 为 Git\\bin\\bash.exe 的绝对路径后重启。');
}
// Values are positional arguments, never interpolated into shell source. A login
// profile may change directory, so explicitly cd afterwards before every command.
export function gitBashInvocation(bash:string,command:readonly string[],website:string):string[]{
 return [bash,'--login','-c','cd -- "$1" || exit $?; shift; printf "[Ops Studio JS] cwd=%s\\n" "$PWD"; exec "$@"','ops-studio-js',website.replaceAll('\\','/'),...command.map(arg=>arg.startsWith('--outputFile=')?arg.replaceAll('\\','/'):arg)];
}
export async function jsExecutionCommand(command:string[],website:string,platform:NodeJS.Platform=process.platform):Promise<string[]>{
 return platform==='win32'?gitBashInvocation(await findGitBash(),command,website):command;
}
export const jsTestInstruction='先进入仓库的 website 目录再执行 npm run test -- --watch=false --watchAll=false --ci --runInBand。Windows 必须使用 Git for Windows 的 Git Bash（优先使用 AUTO_UT_GIT_BASH 指定的 bash.exe），不能通过 cmd、PowerShell 或 WSL 执行；Git Bash 登录初始化后再次 cd 到 website。不要重复执行 mvn clean install。';
