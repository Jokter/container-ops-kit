import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdirSync, realpathSync, existsSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, posix, win32} from 'node:path';

export interface Workspace {account:string; dataRoot:string; home:string; workRoot:string; remoteRoot:string}
const context=new AsyncLocalStorage<Workspace>();
export const currentWorkspace=()=>context.getStore();
export const inWorkspace=<T>(workspace:Workspace,action:()=>T):T=>context.run(workspace,action);
export function makeWorkspace(account:string,dataRoot:string,workRoot:string,remoteRoot:string):Workspace {
 const root=resolve(dataRoot,'users',account),home=join(root,'home'),work=resolve(workRoot,account);
 for(const directory of [root,home,work,join(home,'.config'),join(home,'AppData','Roaming'),join(home,'AppData','Local')])mkdirSync(directory,{recursive:true,mode:0o700});
 return {account,dataRoot:root,home,workRoot:realpathSync(work),remoteRoot:posix.join(remoteRoot,account)};
}
export function accountValue<T extends object>(value:T,key:string):T {
 const account=currentWorkspace()?.account;
 return account?{...value,[key]:account}:value;
}
export function workspacePath(path:string):string {
 const workspace=currentWorkspace();if(!workspace)return resolve(path);
 const target=resolve(path||workspace.workRoot);
 const inside=(value:string)=>{const r=relative(workspace.workRoot,value);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
 if(!inside(target))throw Object.assign(Error('目录必须位于当前用户工作空间内'),{statusCode:403});
 let ancestor=target;while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor);
 if(!inside(realpathSync(ancestor)))throw Object.assign(Error('目录不能通过符号链接访问其它工作空间'),{statusCode:403});
 return target;
}
export function processEnvironment():NodeJS.ProcessEnv {
 const workspace=currentWorkspace();if(!workspace)return {...process.env};
 const env={...process.env};
 // Never reuse the host account's CLI token, proxy Git identity, or agent state.
 for(const key of Object.keys(env))if(/^(?:WELINK_TOKEN|CODEHUB_TOKEN|DTS_TOKEN|GIT_CONFIG.*|GIT_SSH.*|GIT_ASKPASS|SSH_ASKPASS|SSH_AUTH_SOCK|PI_CODING_AGENT_DIR)$/.test(key))delete env[key];
 const quote=(value:string)=>"'"+value.replaceAll("'", "'\"'\"'")+"'";
 const sshRoot=join(workspace.home,'.ssh'),config=join(sshRoot,'config');
 const sshArgs=['ssh','-F',existsSync(config)?config:'none','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent='+(process.env['PLATFORM_SSH_AUTH_SOCK_'+workspace.account.toUpperCase()]?.trim()||'none'),'-o','UserKnownHostsFile="'+join(sshRoot,'known_hosts').replaceAll('\\','/')+'"'];
 // Absolute identity paths avoid OpenSSH resolving ~ against the host OS account on Windows.
 const keys=['id_ed25519','id_rsa','id_ecdsa','id_ed25519_sk','id_ecdsa_sk'].map(name=>join(sshRoot,name)).filter(path=>existsSync(path));
 if(keys.length)for(const key of keys)sshArgs.push('-i',key);else sshArgs.push('-i',join(sshRoot,'id_ed25519'));
 const windowsHome=process.platform==='win32'?{HOMEDRIVE:win32.parse(workspace.home).root.replace(/[\\/]$/,''),HOMEPATH:workspace.home.slice(win32.parse(workspace.home).root.replace(/[\\/]$/,'').length)}:{};
 return {...env,...windowsHome,GIT_CONFIG_GLOBAL:join(workspace.home,'.gitconfig'),GIT_SSH_COMMAND:sshArgs.map(quote).join(' '),GIT_SSH_VARIANT:'ssh',HOME:workspace.home,USERPROFILE:workspace.home,XDG_CONFIG_HOME:join(workspace.home,'.config'),XDG_CACHE_HOME:join(workspace.home,'.cache'),XDG_DATA_HOME:join(workspace.home,'.local','share'),APPDATA:join(workspace.home,'AppData','Roaming'),LOCALAPPDATA:join(workspace.home,'AppData','Local'),PI_CODING_AGENT_DIR:join(workspace.home,'.pi','agent'),GIT_CONFIG_NOSYSTEM:'1',OPS_STUDIO_ACCOUNT:workspace.account};
}
