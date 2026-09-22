import {DtsSettings} from './dts-settings.js';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import {dtsTemplate as template} from './dts-template.js';

const object=z.record(z.string(),z.unknown());
export interface TicketResult {requestId:string;username:string;ticket:string;status:'CREATING'|'DRAFT'|'READY'|'REVIEW';message:string}
type Call=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
export function ticketFields(full:boolean,username:string){
 const fields:Record<string,unknown>={...template.TEMPLATE_DEFAULTS,sBriefDescription:'【代码检视】UT治理',sDetailDescription:'<p>UT治理：修复实际失败用例，按质量报告补充测试，回归通过后提交 MR。</p>',sConfigFlowType:template.FLOW_CONFIG_TYPE,prodInfo:full?template.PROD_INFO_FULL:template.PROD_INFO_DRAFT,dDefectOccurTime:full?Date.now():null,sHandlers:full?username:''};
 return Object.entries(fields).map(([fieldId,value])=>({fieldId,value}));
}
class DtsAuthError extends Error {}
async function client(token:string):Promise<Call>{
 let id=0;
 return async(method,params)=>{
  const response=await fetch(template.DTS_MCP_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','x-auth-token':token},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
  if(response.status===401||response.status===403)throw new DtsAuthError('DTS Token 已失效或无权限，请在连接设置更新。');
  if(!response.ok)throw Error('DTS 请求失败，请检查内网连接及登录状态。');
  const raw=await response.text();let value:unknown;
  if(response.headers.get('content-type')?.includes('text/event-stream')){
   for(const block of raw.split(/\r?\n\r?\n/)){const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]'){const item=object.parse(JSON.parse(data));if(item.id===id)value=item;}}
  }else value=JSON.parse(raw);
  const envelope=object.parse(value);if(envelope.error)throw Error('DTS 网关返回错误，请检查登录状态及建单权限。');
  return envelope.result;
 };
}
async function tool(call:Call,name:string,args:Record<string,unknown>){
 const result=object.parse(await call('tools/call',{name,arguments:args}));
 if(result.isError)throw Error('DTS 操作失败，请在 DTS 确认问题单状态。');
 const content=z.array(z.object({type:z.string(),text:z.string().optional()}).passthrough()).parse(result.content);
 const text=content.filter(c=>c.type==='text').map(c=>c.text??'').join('');
 const data=object.parse(JSON.parse(text));if(data.status!=='success')throw Error('DTS 操作未成功，请在 DTS 确认问题单状态。');return data.result;
}
export class DtsTickets{
 constructor(private readonly store:TaskStore,private readonly connect:()=>Promise<Call>=async()=>client(new DtsSettings(store).token())){for(const value of store.records<TicketResult>('dts-ticket'))if(value.status==='CREATING'||value.status==='DRAFT'){value.status='REVIEW';value.message='服务已重启，建单结果待确认，请在 DTS 查询，勿重复建单。';store.putRecord('dts-ticket',value.requestId,value);}}
 async create(requestId:string,username:string){
  const previous=this.store.getRecord<TicketResult>('dts-ticket',requestId);if(previous)return previous;
  const active=this.store.records<TicketResult>('dts-ticket').find(t=>t.username===username&&['CREATING','DRAFT','REVIEW'].includes(t.status));if(active)return active;
  const value:TicketResult={requestId,username,ticket:'',status:'CREATING',message:'正在建单'};
  const save=()=>this.store.putRecord('dts-ticket',requestId,value);save();let creating=false;
  try{
   const call=await this.connect();await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'container-ops-kit',version:'1.0'}});
   creating=true;
   const number=await tool(call,'createTicket',{arg0:template.FLOW_CONFIG_ID,arg1:template.NODE_MODEL_ID,arg2:false,arg3:ticketFields(false,username),arg4:'SYSTEM',arg5:username,arg6:true,arg7:true});
   value.ticket=z.string().regex(/^DTS\d+$/i).parse(number);value.status='DRAFT';save();
   await tool(call,'executeTicket',{arg0:value.ticket,arg1:template.FLOW_CONFIG_ID,arg2:false,arg3:ticketFields(true,username)});
   const result=object.parse(await tool(call,'batchQueryTicket',{arg0:[value.ticket],arg1:[],arg2:false}));
   const tickets=z.array(object).parse(result.datas);const confirmed=tickets.find(t=>t.dtsBizNo===value.ticket);
   if(!confirmed||confirmed.dtsStatus!=='DTS009')throw Error('单号已生成，流转状态待确认，请在 DTS 检查。');
   value.status='READY';value.message='问题单已创建并流转，单号已填入。';save();
  }catch(error){value.status='REVIEW';value.message=error instanceof DtsAuthError?error.message+(value.ticket?' 已保留草稿单号，请在 DTS 确认。':' 请确认 DTS 是否已建单，勿重复创建。'):value.ticket?'单号已生成，但流转或确认未完成。请在 DTS 检查，勿重复建单。':creating?'建单结果待确认，请先在 DTS 查询，勿重复建单。':error instanceof Error?error.message:'建单准备失败';save();if(!creating)this.store.deleteRecord('dts-ticket',requestId);}
  return value;
 }
}
export function dtsRoutes(app:FastifyInstance,store:TaskStore){const settings=new DtsSettings(store),service=new DtsTickets(store);app.get('/api/auto-ut/dts-settings',async()=>settings.status());app.put('/api/auto-ut/dts-settings',async request=>{const {token}=z.object({token:z.string().trim().min(1).max(16384).regex(/^[^\r\n]+$/)}).parse(request.body);return settings.save(token);});app.delete('/api/auto-ut/dts-settings',async()=>settings.clear());app.post('/api/auto-ut/tickets',async request=>{const input=z.object({requestId:z.uuid(),username:z.string().regex(/^[A-Za-z0-9._-]+$/)}).parse(request.body);return service.create(input.requestId,input.username);});}
