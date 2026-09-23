import {dtsVersion,resolveDtsProduct,dtsProductNames,type DtsProduct} from './dts-product.js';
import {DtsSettings} from './dts-settings.js';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import {dtsTemplate as template} from './dts-template.js';

const object=z.record(z.string(),z.unknown());
export interface TicketResult {requestId:string;username:string;ticket:string;version?:string;product?:DtsProduct;status:'CREATING'|'DRAFT'|'READY'|'REVIEW'|'CANCELLED';message:string;stage?:'CREATE'|'FLOW'|'CONFIRM';nodeStatus?:string;nodeName?:string;currentHandler?:string}
type Call=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
export function ticketFields(full:boolean,username:string,version:string,product:DtsProduct){
 const names=dtsProductNames(version);
 const replacements:Record<string,{value:string;valueName:string}>={sProdRNo:{value:product.rNo,valueName:names.r},sProdCNo:{value:product.cNo,valueName:names.c},sProdBNo:{value:product.bNo,valueName:names.b}};
 const prodInfo=(full?template.PROD_INFO_FULL:template.PROD_INFO_DRAFT).map(field=>({...field,...replacements[field.key]}));
 const fields:Record<string,unknown>={...template.TEMPLATE_DEFAULTS,sBriefDescription:'【代码检视】UT治理',sDetailDescription:'<p>UT治理：修复实际失败用例，按质量报告补充测试，回归通过后提交 MR。</p>',sConfigFlowType:template.FLOW_CONFIG_TYPE,prodInfo,dDefectOccurTime:full?Date.now():null,sHandlers:full?username:''};
 return Object.entries(fields).map(([fieldId,value])=>({fieldId,value}));
}
class DtsAuthError extends Error {}
async function client(token:string):Promise<Call>{
 let id=0;
 return async(method,params)=>{
  const response=await fetch(template.DTS_MCP_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','x-auth-token':token},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
  if(response.status===401||response.status===403)throw new DtsAuthError('DTS Token 已失效或无权限，请在连接设置更新。');
  if(!response.ok)throw Error('DTS 请求失败，请检查内网连接及登录状态。');
  const raw=(await response.text()).replaceAll(token,'[已隐藏]');let value:unknown;
  if(response.headers.get('content-type')?.includes('text/event-stream')){
   for(const block of raw.split(/\r?\n\r?\n/)){const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]'){const item=object.parse(JSON.parse(data));if(item.id===id)value=item;}}
  }else value=JSON.parse(raw);
  const envelope=object.parse(value);if(envelope.error)throw Error('DTS 网关返回错误：'+safeDtsMessage(envelope.error));
  return envelope.result;
 };
}
function safeDtsMessage(value:unknown):string {
 const parsed=object.safeParse(value);const message=typeof value==='string'?value:parsed.success?String(parsed.data.message??parsed.data.error??'接口未提供错误说明'):'接口未提供错误说明';
 return message.replace(/(?:Bearer\s+)[^\s,;]+/gi,'Bearer [已隐藏]').replace(/((?:x-auth-token|authorization|token|password)["']?\s*[:=]\s*)[^\s,;]+/gi,'$1[已隐藏]').replace(/[\r\n]+/g,' ').slice(0,600);
}
async function tool(call:Call,name:string,args:Record<string,unknown>){
 const result=object.parse(await call('tools/call',{name,arguments:args}));
 const content=z.array(z.object({type:z.string(),text:z.string().optional()}).passthrough()).parse(result.content);
 const text=content.filter(c=>c.type==='text').map(c=>c.text??'').join('');
 let data:Record<string,unknown>;
 try{data=object.parse(JSON.parse(text));}catch{throw Error(name+' 返回无法解析：'+safeDtsMessage(text));}
 if(result.isError||data.status!=='success')throw Error(name+' 失败：'+safeDtsMessage(data.error??data.message??text));
 return data.result;
}
export class DtsTickets{
 private readonly active=new Set<string>();
 constructor(private readonly store:TaskStore,private readonly connect:()=>Promise<Call>=async()=>client(new DtsSettings(store).token()),private readonly wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  for(const value of store.records<TicketResult>('dts-ticket'))if(value.status==='CREATING'||value.status==='DRAFT'){value.status='REVIEW';value.message='服务已重启，建单或流转结果待确认，请刷新状态，勿重复建单。';this.save(value);}
 }
 private save(value:TicketResult){this.store.putRecord('dts-ticket',value.requestId,value);}
 private async connection(){const call=await this.connect();await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'container-ops-kit',version:'1.0'}});return call;}
 private async query(call:Call,value:TicketResult){
  const result=object.parse(await tool(call,'batchQueryTicket',{arg0:[value.ticket],arg1:[],arg2:false}));
  const ticket=z.array(object).parse(result.datas).find(t=>t.dtsBizNo===value.ticket);
  if(!ticket)throw Error('查询结果中未找到当前问题单。');
  value.nodeStatus=typeof ticket.dtsStatus==='string'?ticket.dtsStatus:'';
  value.nodeName=typeof ticket.dtsStatusName==='string'?ticket.dtsStatusName:'';
  value.currentHandler=typeof ticket.currentHandler==='string'?ticket.currentHandler:Array.isArray(ticket.currentHandler)&&ticket.currentHandler.every(v=>typeof v==='string')?ticket.currentHandler.join(', '):'';
  const summary='当前节点：'+(value.nodeName||value.nodeStatus||'未知')+'；处理人：'+(value.currentHandler||'未返回');
  const tokens=value.currentHandler.toLowerCase().match(/[a-z0-9._-]+/g)??[];
  const handlerMatches=tokens.some(t=>t===value.username.toLowerCase()||t===value.username.match(/^[a-z](\d+)$/i)?.[1]);
  value.status=['撤销','已撤销'].includes(value.nodeName.trim())?'CANCELLED':value.nodeStatus==='DTS009'&&handlerMatches?'READY':'REVIEW';
  value.message=value.status==='CANCELLED'?'问题单 '+value.ticket+' 已撤销，不再复用；请重新点击自动建单。'+summary:value.status==='READY'?'问题单已流转到开发人员实施修改。'+summary:'问题单尚未确认流转到指定开发人员。'+summary;
  this.save(value);return {nodeStatus:value.nodeStatus,ready:value.status==='READY',cancelled:value.status==='CANCELLED'};
 }
 private product(call:Call,version:string):Promise<DtsProduct>{
  return resolveDtsProduct(version,name=>tool(call,'queryPbiLikeName',{arg0:name,arg1:'valid',arg2:'PBI'}));
 }
 private async execute(call:Call,value:TicketResult){
  value.product??=await this.product(call,value.version??'R27C10');
  value.status='DRAFT';value.stage='FLOW';value.message='正在流转到开发人员实施修改';this.save(value);
  let flowError:unknown;
  try{await tool(call,'executeTicket',{arg0:value.ticket,arg1:template.FLOW_CONFIG_ID,arg2:false,arg3:ticketFields(true,value.username,value.version??'R27C10',value.product)});}
  catch(error){if(error instanceof DtsAuthError)throw error;flowError=error;}
  value.stage='CONFIRM';this.save(value);
  // A lost transition response does not mean the transition failed. Read the
  // original ticket to confirm; never repeat creation or transition here.
  try{
   for(let attempt=0;attempt<3;attempt++){
    await this.wait(2000);
    try{
     const confirmed=await this.query(call,value);
     if(confirmed.ready||confirmed.cancelled)return;
     if(confirmed.nodeStatus!=='DTS001'&&confirmed.nodeStatus!=='DTS009')break;
    }catch(error){if(error instanceof DtsAuthError||attempt===2)throw error;}
   }
  }catch(error){
   if(flowError){value.stage='FLOW';throw Error(safeDtsMessage(flowError instanceof Error?flowError.message:flowError)+'；状态确认也未完成：'+safeDtsMessage(error instanceof Error?error.message:error));}
   throw error;
  }
  if(flowError){value.stage='FLOW';throw flowError;}
 }
 private failure(value:TicketResult,error:unknown){
  value.status='REVIEW';const phase=value.stage==='CREATE'?'建单':value.stage==='FLOW'?'流转':'状态确认';
  value.message=phase+'未完成：'+safeDtsMessage(error instanceof Error?error.message:'未知错误')+(value.ticket?'；已保留单号 '+value.ticket+'，请刷新状态或继续流转，勿重复建单。':'；请在 DTS 确认是否已建单，勿重复创建。');
  this.save(value);
 }
 async create(requestId:string,username:string,version:string){
  version=dtsVersion.parse(version);
  const previous=this.store.getRecord<TicketResult>('dts-ticket',requestId);
  if(previous){if(previous.username!==username||(previous.version??'R27C10')!==version)throw Object.assign(Error('建单请求与用户名或版本不匹配'),{statusCode:409});return previous.ticket&&previous.status==='REVIEW'?this.control(previous.ticket,username,'check',version):previous;}
  const unfinished=this.store.records<TicketResult>('dts-ticket').find(t=>t.username===username&&(t.version??'R27C10')===version&&['CREATING','DRAFT','REVIEW'].includes(t.status));
  if(unfinished)return unfinished.ticket&&unfinished.status==='REVIEW'?this.control(unfinished.ticket,username,'check',version):unfinished;
  if(this.active.has(username))throw Object.assign(Error('该用户正在建单或流转，请稍后刷新'),{statusCode:409});
  this.active.add(username);
  const value:TicketResult={requestId,username,version,ticket:'',status:'CREATING',stage:'CREATE',message:'正在建单'};
  this.save(value);let creating=false;
  try{
   const call=await this.connection();const product=await this.product(call,version);value.product=product;this.save(value);creating=true;
   const number=await tool(call,'createTicket',{arg0:template.FLOW_CONFIG_ID,arg1:template.NODE_MODEL_ID,arg2:false,arg3:ticketFields(false,username,version,product),arg4:'SYSTEM',arg5:username,arg6:true,arg7:true});
   value.ticket=z.string().regex(/^DTS\d+$/i).parse(number);value.status='DRAFT';this.save(value);
   await this.execute(call,value);
  }catch(error){this.failure(value,error);if(!creating)this.store.deleteRecord('dts-ticket',requestId);}
  finally{this.active.delete(username);}
  return value;
 }
 async control(ticket:string,username:string,action:'check'|'continue',version:string){
  version=dtsVersion.parse(version);
  const value=this.store.records<TicketResult>('dts-ticket').find(t=>t.ticket===ticket&&t.username===username&&(t.version??'R27C10')===version);
  if(!value)throw Object.assign(Error('未找到该用户的自动建单记录，请在 DTS 核对该单号。'),{statusCode:404});
  if(this.active.has(username))throw Object.assign(Error('该用户正在建单或流转，请稍后刷新'),{statusCode:409});
  this.active.add(username);
  value.version=version;
  try{
   value.stage='CONFIRM';const call=await this.connection();const {nodeStatus:status}=await this.query(call,value);
   if(action==='continue'&&status==='DTS001')await this.execute(call,value);
   else if(action==='continue'&&value.status!=='READY'){value.message+='；当前非草稿节点，未再次流转。';this.save(value);}
  }catch(error){this.failure(value,error);}
  finally{this.active.delete(username);}
  return value;
 }
}
export function dtsRoutes(app:FastifyInstance,store:TaskStore){const settings=new DtsSettings(store),service=new DtsTickets(store);app.get('/api/auto-ut/dts-settings',async()=>settings.status());app.put('/api/auto-ut/dts-settings',async request=>{const {token}=z.object({token:z.string().trim().min(1).max(16384).regex(/^[^\r\n]+$/)}).parse(request.body);return settings.save(token);});app.delete('/api/auto-ut/dts-settings',async()=>settings.clear());app.post('/api/auto-ut/tickets/control',async request=>{const input=z.object({ticket:z.string().regex(/^DTS\d+$/i),username:z.string().regex(/^[A-Za-z0-9._-]+$/),version:dtsVersion,action:z.enum(['check','continue'])}).parse(request.body);return service.control(input.ticket,input.username,input.action,input.version);});app.post('/api/auto-ut/tickets',async request=>{const input=z.object({requestId:z.uuid(),version:dtsVersion,username:z.string().regex(/^[A-Za-z0-9._-]+$/)}).parse(request.body);return service.create(input.requestId,input.username,input.version);});}
