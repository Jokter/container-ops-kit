import {initializePersonalTools} from './auth/tool-setup.js';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,realpathSync} from 'node:fs';
import {usage,taskPage,taskDomains} from './auth/admin.js';
import Fastify from 'fastify';
import type {FastifyInstance} from 'fastify';
import type {ServerResponse} from 'node:http';
import {dirname,join,relative} from 'node:path';
import {z} from 'zod';
import type {Config} from './config.js';
import {createWorkspaceApp} from './workspace-app.js';
import {TaskStore} from './platform/store.js';
import {accountSchema,passwordMatches,readAuthConfig,Sessions} from './auth/session.js';
import {inWorkspace,makeWorkspace} from './auth/workspace.js';
import type {Workspace} from './auth/workspace.js';

/** The gateway owns authentication; private apps preserve streaming/multipart semantics. */
export async function createApp(config:Config) {
 const initial=readAuthConfig(config.authFile),sessions=new Sessions();
 // Lock the legacy database as the process-wide lock; never assign its records to a random user.
 const lock=new TaskStore(config.database);
 const app=Fastify({bodyLimit:16*1024,forceCloseConnections:true,logger:false});
 const tenants=new Map<string,Promise<{app:FastifyInstance;workspace:Workspace;db:DatabaseSync}>>();
 const connections=new Map<string,Set<ServerResponse>>();
 const disconnect=(token:string)=>{for(const response of connections.get(token)??[])response.destroy();connections.delete(token);};
 let closing=false;
 const tenant=(account:string)=>{
  let pending=tenants.get(account);if(pending)return pending;
  lock.putRecord('user-registry',account,{account});
  pending=(async()=>{const workspace=makeWorkspace(account,dirname(config.database),config.workRoot,config.remoteWorkRoot);
   try{await initializePersonalTools(workspace);}catch{console.warn('个人工具配置自动初始化未完成，请运行 setup-user-tools.bat 检查；已有配置保留。');}
   return inWorkspace(workspace,async()=>{let db:DatabaseSync|undefined;const child=await createWorkspaceApp({...config,database:join(workspace.dataRoot,'tasks.sqlite')},value=>{db=value;});await child.ready();if(!db)throw Error('用户数据库未初始化');return {app:child,workspace,db};});})();
  tenants.set(account,pending);pending.catch(()=>{if(tenants.get(account)===pending)tenants.delete(account);});return pending;
 };
 const stopTenant=async(account:string)=>{const pending=tenants.get(account);if(!pending)return;const value=await pending;await inWorkspace(value.workspace,()=>value.app.close());if(tenants.get(account)===pending)tenants.delete(account);};
 let reconcileRunning=false;
 const reconcile=async()=>{if(closing||reconcileRunning)return;reconcileRunning=true;try{let allowed:string[]=[];try{allowed=readAuthConfig(config.authFile).allowedAccounts;}catch{/* fail closed, stop background work */}for(const account of tenants.keys())if(!allowed.includes(account))await stopTenant(account);sessions.sweep();for(const token of connections.keys()){try{if(sessions.get(token,readAuthConfig(config.authFile)))continue;}catch{/* invalid configuration */}disconnect(token);}}finally{reconcileRunning=false;}};
 const timer=setInterval(()=>{void reconcile().catch(()=>{});},5000);timer.unref();
 app.addHook('onClose',async()=>{closing=true;clearInterval(timer);for(const token of connections.keys())disconnect(token);await Promise.allSettled([...tenants.keys()].map(stopTenant));lock.close();});
 app.setErrorHandler((error,_request,reply)=>{if(error instanceof z.ZodError)return reply.code(400).send({message:'请输入有效的账号和密码'});const status=error instanceof Error&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:500;return reply.code(status).send({message:status===503?'登录配置不可用，请联系管理员':status>=500?'服务暂不可用，请检查配置':error instanceof Error?error.message:'请求失败'});});
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const path=request.url.split('?')[0];
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){
   const origin=request.headers.origin;
   if(request.headers['sec-fetch-site']==='cross-site'||origin&&origin!==`${request.protocol}://${request.headers.host}`)return reply.code(403).send({message:'请求来源不受信任'});
  }
  if(path==='/api/auth/login-config'||path==='/api/auth/login'||path==='/api/auth/logout'||path==='/api/health'||path==='/api/platform/health')return;
  const auth=readAuthConfig(config.authFile),session=sessions.get(sessions.token(request.headers.cookie),auth);
  if(!session)return reply.code(401).send({message:'请先登录'});
  const expected=request.headers['x-ops-account']??new URL(request.url,'http://localhost').searchParams.get('_account');
  if(expected&&expected!==session.account)return reply.code(401).send({message:'登录账号已变化，请重新登录'});
  if(path?.startsWith('/api/admin/')){if(!auth.adminAccounts.includes(session.account))return reply.code(403).send({message:'仅管理员可查看所有用户'});return;}
  if(path==='/api/auth/me')return;
  if(!path?.startsWith('/api/'))return reply.code(404).send({message:'接口不存在'});
  if(closing)return reply.code(503).send({message:'服务正在关闭'});
  const child=await tenant(session.account);
  // Recheck after initialization, before consuming a body or launching work.
  if(!sessions.get(sessions.token(request.headers.cookie),readAuthConfig(config.authFile)))return reply.code(401).send({message:'登录已失效'});
  const token=sessions.token(request.headers.cookie),responses=connections.get(token)??new Set<ServerResponse>();responses.add(reply.raw);connections.set(token,responses);
  const expiry=setTimeout(()=>reply.raw.destroy(),Math.max(1,session.expires-Date.now()));expiry.unref();
  reply.raw.once('close',()=>{clearTimeout(expiry);responses.delete(reply.raw);if(!responses.size)connections.delete(token);});
  reply.hijack();
  inWorkspace(child.workspace,()=>child.app.routing(request.raw,reply.raw));
 });
 const cookie=(token:string,secure:boolean,seconds=43200)=>`ops_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure?'; Secure':''}`;
 // The shared login password is intentionally public; the account whitelist still gates access.
 app.get('/api/auth/login-config',async()=>({defaultPassword:readAuthConfig(config.authFile).defaultPassword}));
 app.post('/api/auth/login',async(request,reply)=>{
  if(!sessions.allow(request.ip))return reply.code(429).send({message:'尝试次数过多，请一分钟后重试'});
  const {account,password}=z.object({account:accountSchema,password:z.string().min(1).max(256)}).strict().parse(request.body),auth=readAuthConfig(config.authFile);
  if(!passwordMatches(password,auth.defaultPassword)||!auth.allowedAccounts.includes(account))return reply.code(401).send({message:'账号未获授权或密码不正确'});
  const child=await tenant(account);const previous=sessions.token(request.headers.cookie);sessions.revoke(previous);disconnect(previous);
  reply.header('Set-Cookie',cookie(sessions.issue(account,auth),request.protocol==='https'));
  const previousUsage=lock.getRecord<{loginCount:number}>('user-usage',account);lock.putRecord('user-usage',account,{lastLoginAt:new Date().toISOString(),loginCount:(previousUsage?.loginCount??0)+1});
  return {account,isAdmin:auth.adminAccounts.includes(account),workDirectory:child.workspace.workRoot,remoteWorkDirectory:child.workspace.remoteRoot};
 });
 app.get('/api/auth/me',async request=>{const session=sessions.get(sessions.token(request.headers.cookie),readAuthConfig(config.authFile))!;const child=await tenant(session.account);return {account:session.account,isAdmin:readAuthConfig(config.authFile).adminAccounts.includes(session.account),workDirectory:child.workspace.workRoot,remoteWorkDirectory:child.workspace.remoteRoot};});
 app.post('/api/auth/logout',async(request,reply)=>{const token=sessions.token(request.headers.cookie);sessions.revoke(token);disconnect(token);return reply.header('Set-Cookie',cookie('',request.protocol==='https',0)).code(204).send();});
 const userRoot=join(dirname(config.database),'users');
 const accounts=()=>[...new Set([...readAuthConfig(config.authFile).allowedAccounts,...lock.records<{account:string}>('user-registry').map(row=>row.account).filter(account=>accountSchema.safeParse(account).success)])].sort();
 const readUser=async<T>(account:string,read:(db:DatabaseSync)=>T):Promise<T|null>=>{
  const active=tenants.get(account);if(active)return read((await active).db);
  const file=join(userRoot,account,'tasks.sqlite');if(!existsSync(file))return null;
  if(lstatSync(join(userRoot,account)).isSymbolicLink()||lstatSync(file).isSymbolicLink()||relative(realpathSync(userRoot),realpathSync(file))!==join(account,'tasks.sqlite'))throw Error('用户目录不合法');
  const db=new DatabaseSync(file,{readOnly:true});try{return read(db);}finally{db.close();}
 };
 app.get('/api/admin/users',async()=>{
  const auth=readAuthConfig(config.authFile),users=[];
  for(const account of accounts()){
   const login=lock.getRecord<{lastLoginAt:string;loginCount:number}>('user-usage',account);
   const base={account,allowed:auth.allowedAccounts.includes(account),isAdmin:auth.adminAccounts.includes(account),lastLoginAt:login?.lastLoginAt??null,loginCount:login?.loginCount??0};
   try{users.push({...base,...await readUser(account,usage),error:null});}catch{users.push({...base,error:'用户数据暂不可读'});}
  }
  return {users};
 });
 app.get('/api/admin/tasks',async request=>{
  const query=z.object({account:accountSchema,kind:z.enum(['all','platform',...taskDomains]).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)}).strict().parse(request.query);
  if(!accounts().includes(query.account))throw Object.assign(Error('用户不存在'),{statusCode:404});
  return await readUser(query.account,db=>taskPage(db,query.kind,query.page,query.pageSize))??{page:query.page,pageSize:query.pageSize,total:0,items:[]};
 });
 app.get('/api/health',async()=>({status:'UP'}));app.get('/api/platform/health',async()=>({status:'UP',backend:'typescript',migrationStage:'complete'}));
 // Existing users' timers restart without waiting for a browser login. No missed jobs replay.
 try{for(const account of initial.allowedAccounts)await tenant(account);}catch(error){await app.close();throw error;}
 return app;
}
