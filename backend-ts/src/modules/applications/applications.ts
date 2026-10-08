import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {TaskStore} from '../../platform/store.js';

const address=z.string().trim().min(1).max(2048).superRefine((value,ctx)=>{
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error();}
  catch{ctx.addIssue({code:'custom',message:'请输入不含账号密码的 HTTP 或 HTTPS 地址'});}
}).transform(value=>new URL(value).href);
const applicationInput=z.object({
  name:z.string().trim().min(1).max(60),url:address,description:z.string().trim().max(200).default(''),
  category:z.enum(['日志检索','监控诊断','研发工具','其他应用']),openMode:z.enum(['embedded','newtab']),
  workspace:z.enum(['','automation','container','virtualization']).default(''),
  environment:z.string().trim().max(80).default(''),owner:z.string().trim().max(80).default(''),
}).strict();
const record=applicationInput.extend({id:z.uuid(),revision:z.number().int().nonnegative(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()});
export type Application=z.infer<typeof record>;
const revision=z.object({revision:z.number().int().nonnegative()}).strict();
const domain='platform-application';
function failure(message:string,statusCode:number){return Object.assign(new Error(message),{statusCode});}

/** Link metadata only: the server never fetches, proxies or executes the configured address. */
export class ApplicationService {
  constructor(private readonly store:TaskStore){}
  list():Application[]{return this.store.records<unknown>(domain).map(value=>record.parse(value)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));}
  private get(id:string):Application{const value=this.store.getRecord<unknown>(domain,id);if(!value)throw failure('应用不存在或已被删除',404);return record.parse(value);}
  create(value:unknown):Application{
    const input=applicationInput.parse(value);if(this.list().length>=500)throw failure('最多可创建 500 个应用',409);
    const now=new Date().toISOString(),item={...input,id:randomUUID(),revision:0,createdAt:now,updatedAt:now};
    this.store.putRecord(domain,item.id,item,now);return item;
  }
  update(id:string,value:unknown):Application{
    const parsed=applicationInput.extend({revision:revision.shape.revision}).strict().parse(value),current=this.get(id);
    if(parsed.revision!==current.revision)throw failure('应用已被其他页面修改，请刷新后重试',409);
    const item={...parsed,id,revision:current.revision+1,createdAt:current.createdAt,updatedAt:new Date().toISOString()};
    this.store.putRecord(domain,id,item,current.createdAt);return item;
  }
  remove(id:string,value:unknown):void{
    const expected=revision.parse(value),current=this.get(id);
    if(expected.revision!==current.revision)throw failure('应用已被修改，请刷新后再删除',409);
    this.store.deleteRecord(domain,id);
  }
}
export function applicationRoutes(app:FastifyInstance,service:ApplicationService){
  const id=(params:unknown)=>z.object({id:z.uuid()}).parse(params).id;
  app.get('/api/platform/applications',async()=>service.list());
  app.post('/api/platform/applications',async(request,reply)=>reply.code(201).send(service.create(request.body)));
  app.put('/api/platform/applications/:id',async request=>service.update(id(request.params),request.body));
  app.delete('/api/platform/applications/:id',async(request,reply)=>{service.remove(id(request.params),request.body);return reply.code(204).send();});
}
