import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import {noFileLogs,type LogSink} from '../../infrastructure/file-logs.js';
import {QualityService,qualityInput} from '../quality/quality.js';
import {AutoUtReports,nextRun,reportDate,reportConfig,type ReportConfig} from '../autout/reports.js';
import {AutoUtService,type Schedule as CsvSchedule} from '../autout/autout.js';
const timing=reportConfig.shape.schedule.omit({enabled:true,action:true});
const csvTask=z.object({kind:z.literal('csv'),reportFileName:z.string().max(500),report:z.string().max(30*1024*1024),username:z.string().regex(/^[A-Za-z0-9._-]+$/),ticket:z.string().regex(/^[A-Za-z0-9._-]+$/),baseBranch:z.string().min(1),workspaceRoot:z.string().min(1)});
const cleanupTask=z.object({kind:z.literal('auto-ut-cleanup'),retentionDays:z.number().int().min(1).max(365)});
export const scheduleInput=z.object({name:z.string().trim().min(1).max(100),enabled:z.boolean(),timing,task:z.discriminatedUnion('kind',[
 z.object({kind:z.literal('quality'),query:qualityInput.omit({date:true}),dateMode:z.enum(['today','yesterday'])}),
 z.object({kind:z.literal('auto-ut'),config:reportConfig}),csvTask,cleanupTask
])}).superRefine((value,ctx)=>{if(value.task.kind==='auto-ut'&&value.task.config.schedule.action==='REPAIR'){const c=value.task.config;if(!c.username||!c.ticket||!c.workspaceRoot||c.versions.some(v=>!v.baseBranch))ctx.addIssue({code:'custom',path:['task','config'],message:'自动修复需要完整执行输入与版本分支'});}});
export type ScheduleInput=z.infer<typeof scheduleInput>;
export interface ManagedSchedule extends ScheduleInput{id:string;createdAt:string;updatedAt:string;nextRunAt:string|null;revision:number;legacy?:'online'|'csv';}
export interface ScheduleRun{id:string;scheduleId:string;name:string;kind:ScheduleInput['task']['kind'];trigger:'MANUAL'|'SCHEDULE';status:'RUNNING'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'SKIPPED'|'INTERRUPTED';createdAt:string;finishedAt:string|null;message:string;jobId?:string;reportId?:string;taskIds:string[];queryPartial?:boolean;snapshot:unknown;}
const onlineId='legacy-online',csvId='legacy-csv';
const scheduleTime=(value:ScheduleInput,after=new Date())=>nextRun({schedule:value.timing},after);
const error=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});
export class UnifiedSchedules{
 private timer:NodeJS.Timeout;private active=new Map<string,Promise<void>>();private closing=false;
 constructor(private readonly store:TaskStore,private readonly quality:QualityService,private readonly reports:AutoUtReports,private readonly autoUt:AutoUtService,private readonly logs:LogSink=noFileLogs){
  this.migrate();
  for(const run of this.runs().filter(r=>r.status==='RUNNING')){run.status='INTERRUPTED';run.message='服务重启，原执行已中断；不自动重放';run.finishedAt=new Date().toISOString();this.saveRun(run);}
  for(const s of this.rawList()){if(s.nextRunAt&&Date.parse(s.nextRunAt)<Date.now()){this.recordSkip(s,'离线期间错过的计划已跳过');s.nextRunAt=s.enabled?scheduleTime(s):null;this.put(s);}}
  this.timer=setInterval(()=>{try{this.tick();this.refreshRuns();}catch{this.logs.task('automation','scheduler',{message:'调度检查失败，请检查后端状态'});}},15000);this.timer.unref();
 }
 private rawList(){return this.store.records<ManagedSchedule>('automation-schedule');}
 private raw(id:string){const s=this.store.getRecord<ManagedSchedule>('automation-schedule',id);if(!s)throw error('定时任务不存在',404);return s;}
 private publicTask(task:ScheduleInput['task']){if(task.kind==='csv'){const{report:_report,...visible}=task;return visible;}return task;}
 private publicSchedule(s:ManagedSchedule){return{...s,task:this.publicTask(s.task),running:this.isRunning(s.id),lastRun:this.runs(s.id)[0]??null};}
 list(){this.refreshRuns();return this.rawList().map(s=>this.publicSchedule(s));}get(id:string){return this.publicSchedule(this.raw(id));}
 runs(id?:string){return this.store.records<ScheduleRun>('automation-schedule-run').filter(r=>!id||r.scheduleId===id);}
 private put(s:ManagedSchedule){s.updatedAt=new Date().toISOString();this.store.putRecord('automation-schedule',s.id,s,s.createdAt);}
 private saveRun(r:ScheduleRun){this.store.putRecord('automation-schedule-run',r.id,r,r.createdAt);this.logs.task('automation',r.id,{time:new Date().toISOString(),scheduleId:r.scheduleId,status:r.status,message:r.message,taskIds:r.taskIds});}
 private parse(value:unknown,previous?:ManagedSchedule){const base=z.object({task:z.object({kind:z.enum(['quality','auto-ut','auto-ut-cleanup','csv'])})}).parse(value);if(base.task.kind==='csv'){if(previous?.task.kind!=='csv')throw error('CSV 计划仅支持迁移已有配置',400);const obj=z.record(z.string(),z.unknown()).parse(value),task=z.record(z.string(),z.unknown()).parse(obj.task);return scheduleInput.parse({...obj,task:{...task,report:previous.task.report}});}return scheduleInput.parse(value);}
 create(value:unknown){const input=this.parse(value),now=new Date().toISOString(),s:ManagedSchedule={...input,id:randomUUID(),createdAt:now,updatedAt:now,nextRunAt:input.enabled?scheduleTime(input):null,revision:1};this.put(s);return this.get(s.id);}
 update(id:string,value:unknown,revision:number){const prior=this.raw(id);if(prior.revision!==revision)throw error('计划已被修改，请刷新后重试');const input=this.parse(value,prior);if(input.task.kind!==prior.task.kind)throw error('不能修改任务类型',400);const s={...prior,...input,revision:prior.revision+1,nextRunAt:input.enabled?scheduleTime(input):null};this.put(s);this.mirror(s);return this.get(id);}
 toggle(id:string,enabled:boolean,revision:number){const s=this.raw(id);return this.update(id,{...s,enabled},revision);}
 delete(id:string,revision:number){const s=this.raw(id);if(s.revision!==revision)throw error('计划已被修改，请刷新后重试');if(this.isRunning(id))throw error('计划正在执行，请先暂停，完成后再删除');this.store.deleteRecord('automation-schedule',id);if(s.legacy==='csv')this.autoUt.deleteSchedule();if(s.legacy==='online'){const c=this.reports.configuration().config;c.schedule.enabled=false;this.reports.configure(c);}}
 private migrate(){if(this.store.getRecord('automation-migration','v1'))return;const online=this.reports.configuration();if(this.store.getRecord('auto-ut-report-config','main'))this.importOnline(online.config);const csv=this.autoUt.getSchedule();if(csv)this.importCsv(csv);this.store.putRecord('automation-migration','v1',{done:true});}
 private importOnline(config:ReportConfig){const input:ScheduleInput={name:'UT 自动修复（原定时计划）',enabled:config.schedule.enabled,timing:config.schedule,task:{kind:'auto-ut',config}};const prior=this.store.getRecord<ManagedSchedule>('automation-schedule',onlineId);const now=new Date().toISOString();this.put({...input,id:onlineId,legacy:'online',createdAt:prior?.createdAt??now,updatedAt:now,revision:(prior?.revision??0)+1,nextRunAt:input.enabled?scheduleTime(input):null});}
 private importCsv(csv:CsvSchedule){const{dailyTime,lastTriggeredOn:_last,updatedAt:_updated,...fields}=csv;const input:ScheduleInput={name:'UT 自动修复（原 CSV 定时）',enabled:true,timing:{frequency:'daily',weekday:1,time:dailyTime,timezone:'Asia/Shanghai'},task:{kind:'csv',...fields}};const prior=this.store.getRecord<ManagedSchedule>('automation-schedule',csvId);const now=new Date().toISOString();this.put({...input,id:csvId,legacy:'csv',createdAt:prior?.createdAt??now,updatedAt:now,revision:(prior?.revision??0)+1,nextRunAt:scheduleTime(input)});}
 saveLegacyOnline(value:unknown){const managed=z.object({managedSchedules:z.boolean().optional()}).parse(value).managedSchedules;const saved=this.reports.configure(value);if(!managed)this.importOnline(saved.config);return saved;}
 saveLegacyCsv(value:Omit<CsvSchedule,'lastTriggeredOn'|'updatedAt'>){const response=this.autoUt.saveSchedule(value);this.importCsv(this.autoUt.getSchedule()!);return response;}
 deleteLegacyCsv(){const s=this.store.getRecord<ManagedSchedule>('automation-schedule',csvId);if(s){s.enabled=false;s.nextRunAt=null;s.revision++;this.put(s);}this.autoUt.deleteSchedule();}
 private mirror(s:ManagedSchedule){if(s.legacy==='online'&&s.task.kind==='auto-ut'){this.reports.configure({...s.task.config,schedule:{...s.task.config.schedule,...s.timing,enabled:s.enabled}});}if(s.legacy==='csv'&&s.task.kind==='csv'){if(s.enabled){const{kind:_kind,...v}=s.task;this.autoUt.saveSchedule({...v,dailyTime:s.timing.time});}else this.autoUt.deleteSchedule();}}
 private isRunning(id:string){return this.active.has(id)||this.runs(id).some(r=>r.status==='RUNNING');}
 private newRun(s:ManagedSchedule,trigger:ScheduleRun['trigger']):ScheduleRun{return{id:randomUUID(),scheduleId:s.id,name:s.name,kind:s.task.kind,trigger,status:'RUNNING',createdAt:new Date().toISOString(),finishedAt:null,message:'已创建执行记录',taskIds:[],snapshot:{...s,task:this.publicTask(s.task)}};}
 private recordSkip(s:ManagedSchedule,message:string){const r=this.newRun(s,'SCHEDULE');r.status='SKIPPED';r.message=message;r.finishedAt=new Date().toISOString();this.saveRun(r);return r;}
 runNow(id:string,trigger:ScheduleRun['trigger']='MANUAL'){
  this.refreshRuns();const s=this.raw(id);if(this.closing)throw error('服务正在关闭');if(this.isRunning(id)){if(trigger==='SCHEDULE')return this.recordSkip(s,'上一次执行仍在运行，跳过本次触发');throw error('该计划正在执行，不能重复启动');}
  const r=this.newRun(s,trigger);this.saveRun(r);const promise=this.execute(s,r).catch(()=>{r.status='FAILED';r.message='执行异常，请检查关联日志';r.finishedAt=new Date().toISOString();this.saveRun(r);}).finally(()=>this.active.delete(id));this.active.set(id,promise);return this.store.getRecord<ScheduleRun>('automation-schedule-run',r.id)!;
 }
 async wait(id:string){await this.active.get(id);this.refreshRuns();return this.runs(id)[0];}
 private async execute(s:ManagedSchedule,r:ScheduleRun){
  try{const task=s.task;
   if(task.kind==='quality'){const date=reportDate({dateMode:task.dateMode,schedule:s.timing});const job=this.quality.start({...task.query,date});r.jobId=job.id;r.message='正在查询质量报告';this.saveRun(r);const done=await this.quality.wait(job.id);r.status=done.status==='SUCCEEDED'?'SUCCEEDED':done.status==='PARTIAL'?'PARTIAL':done.status==='INTERRUPTED'?'INTERRUPTED':'FAILED';r.message=done.parts.map(p=>`${p.version} / ${p.kind}：${p.message}`).join('\n');}
   else if(task.kind==='auto-ut'){const config={...task.config,schedule:{...task.config.schedule,...s.timing}};const run=this.reports.fetchReport('SCHEDULE',config);r.reportId=run.id;r.jobId=run.jobId;r.message='正在获取 UT 报告';this.saveRun(r);const done=await this.reports.wait(run.id);r.taskIds=done.taskIds;r.queryPartial=done.status==='PARTIAL';r.status=done.status==='READY'?'SUCCEEDED':done.status==='PARTIAL'?'PARTIAL':done.status==='INTERRUPTED'?'INTERRUPTED':'FAILED';r.message=done.messages.join('\n');if(done.messages.some(m=>m.includes('启动失败')))r.status='FAILED';if(r.taskIds.length){r.status='RUNNING';r.message='修复任务已创建，等待执行完成';}}
   else if(task.kind==='auto-ut-cleanup'){const result=await this.autoUt.cleanup(task.retentionDays);r.taskIds=result.deleted;r.status=result.failed.length?'PARTIAL':'SUCCEEDED';r.message=`已删除 ${result.deleted.length} 个任务及代码目录${result.failed.length?`，${result.failed.length} 个清理失败`:''}`;}
   else{r.message='正在启动已保存的 CSV 任务';this.saveRun(r);const tasks=await this.autoUt.start(Buffer.from(task.report,'base64'),task.username,task.ticket,task.baseBranch,task.workspaceRoot,'AUTOMATIC');r.taskIds=tasks.map(t=>t.id);r.status=tasks.length?'RUNNING':'SUCCEEDED';r.message=tasks.length?'修复任务已创建，等待执行完成':'报告中没有待修复仓库';}
  }catch(e){const conflict=e instanceof Error&&'statusCode' in e&&e.statusCode===409;r.status=conflict?'SKIPPED':'FAILED';r.message=conflict?'同类报告正在获取或任务创建中，本次跳过':'执行失败，请检查查询配置、执行参数和工作目录';}
  if(r.status!=='RUNNING')r.finishedAt=new Date().toISOString();this.saveRun(r);
 }
 refreshRuns(){for(const r of this.runs().filter(r=>r.status==='RUNNING'&&r.taskIds.length)){const tasks=this.autoUt.tasks().filter(t=>r.taskIds.includes(t.id));if(tasks.length!==r.taskIds.length){r.status='FAILED';r.message='关联的 UT 修复任务已被删除';r.finishedAt=new Date().toISOString();this.saveRun(r);continue;}if(tasks.some(t=>['DISCOVERED','PREPARING','BASELINE_RUNNING','REPAIRING','VERIFYING','PR_CREATING','WAITING_CONFIRMATION'].includes(t.status)))continue;r.status=tasks.every(t=>t.status==='RESOLVED')?(r.queryPartial?'PARTIAL':'SUCCEEDED'):'FAILED';r.message=r.status==='SUCCEEDED'?'全部修复任务已完成，MR 已创建':r.status==='PARTIAL'?'成功版本的修复已完成，部分版本报告查询失败':'部分任务需要人工处理，请打开关联任务';r.finishedAt=new Date().toISOString();this.saveRun(r);}}
 tick(now=new Date()){if(this.closing)return;this.refreshRuns();for(const s of this.rawList()){if(!s.enabled||!s.nextRunAt||Date.parse(s.nextRunAt)>now.getTime())continue;const due=Date.parse(s.nextRunAt);s.nextRunAt=scheduleTime(s,now);this.put(s);if(now.getTime()-due>60000)this.recordSkip(s,'错过计划时间，不补跑');else this.runNow(s.id,'SCHEDULE');}}
 stop(){this.closing=true;clearInterval(this.timer);}async close(){this.stop();await Promise.allSettled(this.active.values());}
}
export function scheduleRoutes(app:FastifyInstance,s:UnifiedSchedules){const id=(v:unknown)=>z.object({id:z.string().min(1).max(100)}).parse(v).id;app.get('/api/automation/schedules',async()=>s.list());app.post('/api/automation/schedules',async(req,reply)=>reply.code(201).send(s.create(req.body)));app.get('/api/automation/schedules/:id',async req=>s.get(id(req.params)));app.put('/api/automation/schedules/:id',async req=>{const{revision}=z.object({revision:z.number().int().positive()}).parse(req.body);return s.update(id(req.params),req.body,revision);});app.patch('/api/automation/schedules/:id',async req=>{const v=z.object({enabled:z.boolean(),revision:z.number().int().positive()}).parse(req.body);return s.toggle(id(req.params),v.enabled,v.revision);});app.delete('/api/automation/schedules/:id',async(req,reply)=>{const{revision}=z.object({revision:z.number().int().positive()}).parse(req.body);s.delete(id(req.params),revision);return reply.code(204).send();});app.post('/api/automation/schedules/:id/runs',async(req,reply)=>reply.code(202).send(s.runNow(id(req.params))));app.get('/api/automation/schedules/:id/runs',async req=>s.runs(id(req.params)));}
