import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {TaskStore} from '../../platform/store.js';
import type {GroupMrService} from './group-mr.js';
export function effectivenessRoutes(app:FastifyInstance,store:TaskStore,service:GroupMrService){
 app.get('/api/automation/effectiveness',async request=>{
  const {days}=z.object({days:z.coerce.number().int().refine(v=>[7,30,90].includes(v)).default(30)}).parse(request.query),cutoff=Date.now()-days*86400000;
  const all=service.list(),first=new Map<string,number>();for(const e of all){const key=e.repo+':'+e.iid;first.set(key,Math.min(first.get(key)??Infinity,Date.parse(e.createdAt)));}const keys=new Set([...first].filter(([,time])=>time>=cutoff).map(([key])=>key));
  const latest=[...keys].map(key=>all.filter(e=>e.repo+':'+e.iid===key).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]!);
  const reviews=service.knowledge.reviews().filter(r=>Date.parse(r.time)>=cutoff),waits=reviews.map(r=>r.waitMs).sort((a,b)=>a-b);
  const percentile=(values:number[],p:number)=>values.length?values[Math.ceil(values.length*p)-1]!:null;
  const merged=latest.filter(e=>e.phase==='DONE').length,anomalies=latest.filter(e=>all.some(a=>a.repo===e.repo&&a.iid===e.iid&&a.events.some(v=>['FAILED','INTERRUPTED','NO_PERMISSION'].includes(v.phase)&&!v.message.startsWith('收到新的 MR 消息')))).length;
  const stages:Record<string,number[]>={};for(const e of all.filter(e=>Date.parse(e.createdAt)>=cutoff)){
   let start=e.events[0];for(const next of e.events.slice(1)){if(!start){start=next;continue;}if(start.phase===next.phase)continue;(stages[start.phase]??=[]).push(Math.max(0,Date.parse(next.time)-Date.parse(start.time)));start=next;}
  }
  const taskIds=new Set<string>();for(const domain of ['auto-ut-task','auto-ut-governance','quality-job','auto-ut-report-run'])for(const r of store.records<{id:string;createdAt:string}>(domain))if(Date.parse(r.createdAt)>=cutoff)taskIds.add((domain.startsWith('auto-ut-')&&['auto-ut-task','auto-ut-governance'].includes(domain)?'ut':domain)+':'+r.id);
  const touches=store.records<{time:string}>('automation-intervention').filter(r=>Date.parse(r.time)>=cutoff).length+reviews.length;
  return {days,tasks:taskIds.size+latest.length,humanTouches:touches,total:latest.length,merged,pending:latest.filter(e=>!['DONE','FAILED','NO_PERMISSION','INTERRUPTED'].includes(e.phase)).length,anomalies,reviews:reviews.length,rejected:reviews.filter(r=>r.decision==='reject').length,waitMedianMs:percentile(waits,.5),waitP90Ms:percentile(waits,.9),waitMeanMs:waits.length?waits.reduce((a,b)=>a+b,0)/waits.length:null,missed:reviews.filter(r=>r.category==='AI 漏检').length,falsePositive:reviews.filter(r=>r.category==='AI 误报').length,knowledge:service.knowledge.list().filter(k=>k.status==='active').length,knowledgeUses:store.records<{time:string}>('knowledge-use').filter(r=>Date.parse(r.time)>=cutoff).length,stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,percentile(v.sort((a,b)=>a-b),.5)])),aiConfirmedRate:null};
 });
}
