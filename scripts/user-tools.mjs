import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,delimiter} from 'node:path';
import {readConfig} from '../dist/backend-ts/src/config.js';
import {readAuthConfig,accountSchema} from '../dist/backend-ts/src/auth/session.js';
import {makeWorkspace,inWorkspace,processEnvironment} from '../dist/backend-ts/src/auth/workspace.js';
import {importLocalToolFiles} from '../dist/backend-ts/src/auth/tool-setup.js';
import {TaskStore} from '../dist/backend-ts/src/platform/store.js';

const account=accountSchema.parse(process.argv[2]||'w00789509'),action=process.argv[3]||'check',config=readConfig();
if(!['check','import-local','welink-login'].includes(action))throw Error('支持 check、import-local、welink-login');
if(!readAuthConfig(config.authFile).allowedAccounts.includes(account))throw Error('目标账号必须已加入白名单');
let lock;
try{
 lock=new TaskStore(config.database); // Never modify tool configuration while backend tasks may be running.
 const workspace=makeWorkspace(account,dirname(config.database),config.workRoot,config.remoteWorkRoot);
 await inWorkspace(workspace,async()=>{
  const env=processEnvironment(),git=process.platform==='win32'?'git.exe':'git';
  if(action==='import-local'){
   const result=importLocalToolFiles(homedir(),workspace.home);
   // Import only Git author identity, not credential helpers or arbitrary include paths.
   let identities=0;
   for(const key of ['user.name','user.email']){
    const current=spawnSync(git,['config','--global','--get',key],{env,encoding:'utf8',windowsHide:true});if(current.status===0&&current.stdout.trim())continue;
    const source=spawnSync(git,['config','--global','--get',key],{encoding:'utf8',windowsHide:true});if(source.status!==0||!source.stdout.trim())continue;
    const saved=spawnSync(git,['config','--global',key,source.stdout.trim()],{env,stdio:'ignore',windowsHide:true});if(saved.status!==0)throw Error('Git 提交身份写入失败');identities++;
   }
   console.log(`已为 ${account} 导入 ${result.copied} 个配置文件和 ${identities} 项 Git 身份；保留 ${result.kept} 个已有文件。源文件不删除，不导入其他账号。`);
  }
  if(action==='welink-login'){
   const result=spawnSync(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'welink-cli',process.platform==='win32'?['/d','/s','/c','welink-cli auth login']:['auth','login'],{env:processEnvironment(),cwd:workspace.workRoot,stdio:'inherit'});process.exitCode=result.status??1;return;
  }
  const available=name=>(process.env.PATH||'').split(delimiter).some(dir=>(process.platform==='win32'?['.exe','.cmd','.bat']:['']).some(ext=>existsSync(join(dir.replaceAll('"',''),name+ext))));
  console.log(`账号：${account}\n个人配置目录：${workspace.home}`);
  for(const name of ['git','ssh','uv','uvx','welink-cli','codehub-cli','pi','java','mvn'])console.log(`${name}: ${available(name)?'已找到程序':'PATH 中未找到程序'}`);
  for(const path of ['.ssh/known_hosts','.ssh/config','.pi/agent/auth.json','.pi/agent/models.json'])console.log(`${path}: ${existsSync(join(workspace.home,path))?'已有配置文件':'未配置（可按需配置）'}`);
  const keys=['id_ed25519','id_rsa','id_ecdsa','id_ed25519_sk','id_ecdsa_sk'].some(name=>existsSync(join(workspace.home,'.ssh',name)));
  console.log(`标准 SSH 私钥：${keys?'已找到':'未找到；自定义密钥请在个人 .ssh/config 中用绝对路径配置'}`);
  for(const key of ['user.name','user.email']){const result=spawnSync(git,['config','--global','--get',key],{env:processEnvironment(),encoding:'utf8',windowsHide:true});console.log(`Git ${key}: ${result.status===0&&result.stdout.trim()?'已配置':'未配置'}`);}
  console.log('以上只检查本地配置是否存在，不代表远端认证通过；不会访问仓库、发送消息或创建工单。');
  console.log('WeLink CLI 需要单独登录；CodeHub / WeLink MCP / DTS Token 请在当前账号连接设置中维护。Maven 沿用项目 .ci/settings.xml 与已配置的命令。');
 });
}catch(error){console.error(error?.code==='ERR_SQLITE_ERROR'?'请先关闭 Ops Studio 后端，再运行配置工具。':error instanceof Error?error.message:'配置检查失败');process.exitCode=1;}finally{lock?.close();}
