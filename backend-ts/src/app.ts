import Fastify from 'fastify';
import type {FastifyInstance} from 'fastify';
import type {ServerResponse} from 'node:http';
import {dirname,join} from 'node:path';
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
 const tenants=new Map<string,Promise<{app:FastifyInstance;workspace:Workspace}>>();
 const connections=new Map<string,Set<ServerResponse>>();
 const disconnect=(token:string)=>{for(const response of connections.get(token)??[])response.destroy();connections.delete(token);};
 let closing=false;
 const tenant=(account:string)=>{
  let pending=tenants.get(account);if(pending)return pending;
  pending=(async()=>{const workspace=makeWorkspace(account,dirname(config.database),config.workRoot,config.remoteWorkRoot);
   return inWorkspace(workspace,async()=>{const child=await createWorkspaceApp({...config,database:join(workspace.dataRoot,'tasks.sqlite')});await child.ready();return {app:child,workspace};});})();
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
  if(path==='/api/auth/login'||path==='/api/auth/logout'||path==='/api/health'||path==='/api/platform/health')return;
  const auth=readAuthConfig(config.authFile),session=sessions.get(sessions.token(request.headers.cookie),auth);
  if(!session)return reply.code(401).send({message:'请先登录'});
  const expected=request.headers['x-ops-account']??new URL(request.url,'http://localhost').searchParams.get('_account');
  if(expected&&expected!==session.account)return reply.code(401).send({message:'登录账号已变化，请重新登录'});
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
 app.post('/api/auth/login',async(request,reply)=>{
  if(!sessions.allow(request.ip))return reply.code(429).send({message:'尝试次数过多，请一分钟后重试'});
  const {account,password}=z.object({account:accountSchema,password:z.string().min(1).max(256)}).strict().parse(request.body),auth=readAuthConfig(config.authFile);
  if(!passwordMatches(password,auth.defaultPassword)||!auth.allowedAccounts.includes(account))return reply.code(401).send({message:'账号未获授权或密码不正确'});
  const child=await tenant(account);const previous=sessions.token(request.headers.cookie);sessions.revoke(previous);disconnect(previous);
  reply.header('Set-Cookie',cookie(sessions.issue(account,auth),request.protocol==='https'));
  return {account,workDirectory:child.workspace.workRoot,remoteWorkDirectory:child.workspace.remoteRoot};
 });
 app.get('/api/auth/me',async request=>{const session=sessions.get(sessions.token(request.headers.cookie),readAuthConfig(config.authFile))!;const child=await tenant(session.account);return {account:session.account,workDirectory:child.workspace.workRoot,remoteWorkDirectory:child.workspace.remoteRoot};});
 app.post('/api/auth/logout',async(request,reply)=>{const token=sessions.token(request.headers.cookie);sessions.revoke(token);disconnect(token);return reply.header('Set-Cookie',cookie('',request.protocol==='https',0)).code(204).send();});
 app.get('/api/health',async()=>({status:'UP'}));app.get('/api/platform/health',async()=>({status:'UP',backend:'typescript',migrationStage:'complete'}));
 // Existing users' timers restart without waiting for a browser login. No missed jobs replay.
 try{for(const account of initial.allowedAccounts)await tenant(account);}catch(error){await app.close();throw error;}
 return app;
}
