import {copyFileSync,constants,existsSync,lstatSync,mkdirSync,readdirSync,chmodSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';

import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inWorkspace,processEnvironment,type Workspace} from './workspace.js';

const run=promisify(execFile);
// Only this explicitly designated owner may initialize from the backend OS user's credentials.
export async function initializePersonalTools(workspace:Workspace,sourceHome=homedir()):Promise<boolean>{
 if(workspace.account!=='w00789509')return false;
 const marker=join(workspace.home,'.local-tools-initialized');
 if(existsSync(marker))return false;
 importLocalToolFiles(sourceHome,workspace.home);
 const env=inWorkspace(workspace,processEnvironment),git=process.platform==='win32'?'git.exe':'git';
 const read=async(key:string,environment:NodeJS.ProcessEnv)=>{
  try{return (await run(git,['config','--global','--get',key],{env:environment,timeout:5000,windowsHide:true})).stdout.trim();}catch{return '';}
 };
 for(const key of ['user.name','user.email']){
  if(await read(key,env))continue;
  const value=await read(key,{...process.env,GIT_CONFIG_GLOBAL:join(sourceHome,'.gitconfig')});
  if(value)try{await run(git,['config','--global',key,value],{env,timeout:5000,windowsHide:true});}catch{throw Error('个人 Git 身份初始化失败');}
 }
 writeFileSync(marker,'1\n',{flag:'wx',mode:0o600});
 return true;
}

// Explicit local setup can also import credentials for their owner.
export function importLocalToolFiles(sourceHome:string,targetHome:string){
 const source=resolve(sourceHome),target=resolve(targetHome);if(source===target)throw Error('源目录和目标用户目录不能相同');
 let copied=0,kept=0;
 const checkTarget=(path:string)=>{let current=path;while(current!==dirname(current)){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('目标目录不能通过符号链接写入');current=dirname(current);}};
 const copy=(from:string,to:string)=>{
  if(!existsSync(from))return;const info=lstatSync(from);if(info.isSymbolicLink())return;
  checkTarget(to);if(info.isDirectory()){mkdirSync(to,{recursive:true,mode:0o700});for(const name of readdirSync(from)){if(['sessions','node_modules','.git'].includes(name))continue;copy(join(from,name),join(to,name));}}
  else if(info.isFile()){if(existsSync(to)){kept++;return;}mkdirSync(dirname(to),{recursive:true,mode:0o700});copyFileSync(from,to,constants.COPYFILE_EXCL);chmodSync(to,0o600);copied++;}
 };
 for(const part of ['.ssh','.pi/agent']){const from=join(source,part),to=join(target,part);const boundary=relative(from,target);if(!boundary||(!boundary.startsWith('..')&&!isAbsolute(boundary)))throw Error('目标目录不能放在待导入目录中');copy(from,to);}
 return{copied,kept};
}
export function gitFailureHint(output:string,home:string){
 if(/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(output))return 'SSH 主机密钥发生变化，请先向 CodeHub 管理员核验；不会自动删除 known_hosts 或关闭校验。';
 if(/Host key verification failed/i.test(output))return `SSH 主机信任校验失败。请核对当前账号 ${join(home,'.ssh','known_hosts')}；可运行 setup-user-tools.bat 为本人账号导入已核验的本机 SSH 配置。`;
 if(/Permission denied.*publickey/i.test(output))return `CodeHub 未接受当前账号的 SSH 公钥，请检查 ${join(home,'.ssh')} 中的个人密钥及 CodeHub 公钥配置；Ops Studio 登录和 CodeHub Token 不能代替 Git SSH 认证。`;
 if(/Author identity unknown|unable to auto-detect email address|Please tell me who you are/i.test(output))return `当前账号缺少 Git 提交身份，请运行 setup-user-tools.bat 导入本人的 Git user.name 和 user.email。`;
 return '';
}
