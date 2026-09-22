import type {UnifiedSchedules} from '../automation/schedules.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {TaskStore} from '../../platform/store.js';
import {noFileLogs,type LogSink} from '../../infrastructure/file-logs.js';
import {metric,QualityService,qualityCsv,releaseVersion,type QualityJob,type QualityRow} from '../quality/quality.js';
import {AutoUtService} from './autout.js';
const branch=z.string().trim().max(200).refine(v=>!v||/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v)&&!v.includes('..')&&!v.includes('//')&&!v.endsWith('/')&&!v.endsWith('.'));
const ident=z.string().trim().max(120).regex(/^[A-Za-z0-9._-]*$/);
export const reportConfig=z.object({maxClasses:z.coerce.number().int().min(1).max(20).optional(),versions:z.array(z.object({version:releaseVersion,baseBranch:branch})).min(1).max(10).refine(v=>new Set(v.map(x=>x.version)).size===v.length),dateMode:z.enum(['today','yesterday']),username:ident,ticket:ident,workspaceRoot:z.string().trim().max(4096),schedule:z.object({enabled:z.boolean(),frequency:z.enum(['daily','weekdays','weekly']),weekday:z.number().int().min(0).max(6),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.enum(['Asia/Shanghai','UTC']),action:z.enum(['FETCH','REPAIR'])})});
export type ReportConfig=z.infer<typeof reportConfig>;
interface SavedConfig{config:ReportConfig;nextRunAt:string|null;}
interface PlanItem{version:string;repository:string;failedTests:number;lineCoverage:number;lineGoal:number;branchCoverage:number;branchGoal:number;baseBranch:string;repositoryUrl:string;repositoryCustomized:boolean;configured:boolean;repairBranch:string;}
export interface ReportRun{id:string;jobId:string;trigger:'MANUAL'|'SCHEDULE';status:'FETCHING'|'READY'|'PARTIAL'|'FAILED'|'INTERRUPTED';createdAt:string;config:ReportConfig;plan:PlanItem[];taskIds:string[];messages:string[];claimed:string[];}
export function nextRun(config:{schedule:Omit<ReportConfig['schedule'],'enabled'|'action'>},after=new Date()):string{
 const schedule=config.schedule,offset=schedule.timezone==='Asia/Shanghai'?8:0,wall=new Date(after.getTime()+offset*3600000),[h,m]=schedule.time.split(':').map(Number);
 for(let n=0;n<9;n++){const d=new Date(Date.UTC(wall.getUTCFullYear(),wall.getUTCMonth(),wall.getUTCDate()+n,h,m)),weekday=d.getUTCDay(),stamp=d.getTime()-offset*3600000;if(stamp<=after.getTime()||schedule.frequency==='weekdays'&&(weekday===0||weekday===6)||schedule.frequency==='weekly'&&weekday!==schedule.weekday)continue;return new Date(stamp).toISOString();}throw new Error('无法计算定时时间');
}
export function reportDate(config:{dateMode:ReportConfig['dateMode'];schedule:{timezone:ReportConfig['schedule']['timezone']}},now=new Date()){const offset=config.schedule.timezone==='Asia/Shanghai'?8:0;return new Date(now.getTime()+offset*3600000-(config.dateMode==='yesterday'?86400000:0)).toISOString().slice(0,10);}
const defaults:ReportConfig={versions:[{version:'R27C10',baseBranch:''},{version:'R27C00',baseBranch:''}],dateMode:'yesterday',username:'',ticket:'',workspaceRoot:'',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:30',timezone:'Asia/Shanghai',action:'FETCH'}};
function executionReady(config:ReportConfig){return !!(config.username&&config.ticket&&config.workspaceRoot&&config.versions.every(v=>v.baseBranch));}
export class AutoUtReports{
 private deleting=new Set<string>();private starts=new Map<string,Promise<ReportRun>>();private timer:NodeJS.Timeout;private readonly completions=new Map<string,Promise<void>>();private fetching=false;private starting=false;private pending=new Set<Promise<unknown>>();private closed=false;
 constructor(private readonly store:TaskStore,private readonly quality:QualityService,private readonly autoUt:AutoUtService,private readonly logs:LogSink=noFileLogs,private readonly ownScheduler=true){
  for(const run of this.list().filter(r=>r.status==='FETCHING')){run.status='INTERRUPTED';run.messages.push('服务重启，需手动重新获取');this.save(run);}
  const saved=this.configuration();if(saved.nextRunAt&&Date.parse(saved.nextRunAt)<Date.now()){this.logs.task('auto-ut','report-scheduler',{time:new Date().toISOString(),message:'服务离线期间的计划已跳过，不补跑',scheduledAt:saved.nextRunAt});saved.nextRunAt=nextRun(saved.config);this.store.putRecord('auto-ut-report-config','main',saved);}
  this.timer=setInterval(()=>{if(!this.closed&&this.ownScheduler)this.track(this.tick());},15000);this.timer.unref();
 }
 private track<T>(promise:Promise<T>){this.pending.add(promise);void promise.catch(()=>this.logs.task('auto-ut','report-scheduler',{time:new Date().toISOString(),message:'报告调度异常，请检查任务记录'})).finally(()=>this.pending.delete(promise));return promise;}
 async close(){this.closed=true;clearInterval(this.timer);await Promise.allSettled(this.pending);}
 configuration():SavedConfig{return this.store.getRecord<SavedConfig>('auto-ut-report-config','main')??{config:structuredClone(defaults),nextRunAt:null};}
 configure(value:unknown){const config=reportConfig.parse(value);if(config.schedule.enabled&&config.schedule.action==='REPAIR'&&!executionReady(config))throw Object.assign(new Error('自动修复必须填写各版本分支、用户名、单号和工作目录'),{statusCode:400});const saved={config,nextRunAt:config.schedule.enabled?nextRun(config):null};this.store.putRecord('auto-ut-report-config','main',saved);return saved;}
 list(){return this.store.records<ReportRun>('auto-ut-report-run');}get(id:string){const run=this.store.getRecord<ReportRun>('auto-ut-report-run',id);if(!run)throw Object.assign(new Error('报告获取记录不存在'),{statusCode:404});return run;}
 private save(run:ReportRun){this.store.putRecord('auto-ut-report-run',run.id,run,run.createdAt);this.logs.task('auto-ut',run.id,{time:new Date().toISOString(),status:run.status,message:run.messages.at(-1)??'开始获取报告',taskIds:run.taskIds});}
 fetchReport(trigger:'MANUAL'|'SCHEDULE'='MANUAL',snapshot?:ReportConfig){
  if(this.closed||this.fetching)throw Object.assign(new Error('报告正在获取，请等待本次完成'),{statusCode:409});const config=reportConfig.parse(snapshot??this.configuration().config);
  const job=this.quality.start({versions:config.versions.map(v=>v.version),date:new Date().toISOString().slice(0,10),latest:true,domain:'Access',teams:['Access_智能驾舱组'],kinds:['ut']});
  const run:ReportRun={id:randomUUID(),jobId:job.id,trigger,status:'FETCHING',createdAt:new Date().toISOString(),config,plan:[],taskIds:[],messages:[],claimed:[]};this.save(run);this.fetching=true;
  const completion=this.track(this.complete(run).finally(()=>{this.fetching=false;this.completions.delete(run.id);}));this.completions.set(run.id,completion);return run;
 }
 async remove(id:string){
  if(this.deleting.has(id))throw Object.assign(new Error('记录正在停止并清理'),{statusCode:409});
  const run=this.list().find(r=>r.id===id);if(!run)return;
  this.deleting.add(id);
  try{await this.quality.stop(run.jobId);await this.completions.get(id);await this.starts.get(id);
   const related=this.autoUt.tasks().filter(t=>t.sourceReportId===id).map(t=>t.id);
   for(const taskId of new Set([...this.get(id).taskIds,...related]))await this.autoUt.removeExecutionRecord(taskId);
   await this.quality.remove(run.jobId);this.store.deleteRecord('auto-ut-report-run',id);
  }finally{this.deleting.delete(id);}
 }
 async wait(id:string){await this.completions.get(id);return this.get(id);}
 private async complete(run:ReportRun){try{const job=await this.quality.wait(run.jobId);if(this.closed||this.deleting.has(run.id)){run.status='INTERRUPTED';this.save(run);return;}
  run.plan=this.plan(job,run.config);run.status=job.status==='FAILED'?'FAILED':job.status==='INTERRUPTED'?'INTERRUPTED':job.status==='PARTIAL'?'PARTIAL':'READY';run.messages=job.parts.map(p=>`${p.version}：${p.message}`);this.save(run);
  if(run.trigger==='SCHEDULE'&&run.config.schedule.action==='REPAIR'&&['READY','PARTIAL'].includes(run.status))await this.start(run.id,'AUTOMATIC');
 }catch{if(this.deleting.has(run.id))return;run=this.get(run.id);run.messages.push('报告处理或自动修复启动失败，请检查配置和工作目录');if(run.status==='FETCHING')run.status='FAILED';this.save(run);}finally{this.logs.task('auto-ut',run.id,{time:new Date().toISOString(),status:run.status,messages:run.messages});}}
 private plan(job:QualityJob,config:ReportConfig):PlanItem[]{const plan:PlanItem[]=[];for(const part of job.parts){if(part.status!=='SUCCEEDED')continue;const baseBranch=config.versions.find(v=>v.version===part.version)!.baseBranch;
  for(const row of part.rows){if(String(row['语言']).toLowerCase()!=='java'||row['PL组']!=='Access_智能驾舱组')continue;const repository=String(row['代码仓']);if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository))throw new Error('代码仓名称无效');const mapping=this.store.getRecord<{url:string}>('auto-ut-repository',repository.toLowerCase());
   plan.push({version:part.version,repository,failedTests:metric(row['失败用例']),lineCoverage:metric(row['行覆盖率'],true),lineGoal:Math.min(metric(row['行覆盖率目标'],true),.8),branchCoverage:metric(row['分支覆盖率'],true),branchGoal:Math.min(metric(row['分支覆盖率目标'],true),.7),baseBranch,repositoryUrl:mapping?.url??`ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/${repository}.git`,repositoryCustomized:!!mapping,configured:!!baseBranch,repairBranch:baseBranch&&config.username&&config.ticket?`${baseBranch}_${config.username}_${config.ticket}`:''});
  }}return plan;
 }
 start(id:string,mode:'MANUAL'|'AUTOMATIC',selected?:string[]){
  if(this.deleting.has(id)||this.starts.has(id))throw Object.assign(new Error('记录正在停止或创建任务'),{statusCode:409});
  const work=this.startWork(id,mode,selected).finally(()=>this.starts.delete(id));this.starts.set(id,work);return work;
 }
 private async startWork(id:string,mode:'MANUAL'|'AUTOMATIC',selected?:string[]){
  if(this.closed||this.starting)throw Object.assign(new Error('正在创建修复任务，请稍后重试'),{statusCode:409});const run=this.get(id);if(!['READY','PARTIAL'].includes(run.status))throw Object.assign(new Error('报告尚未就绪'),{statusCode:409});if(!executionReady(run.config))throw Object.assign(new Error('请保存完整执行配置后重新获取报告'),{statusCode:400});this.starting=true;
  try{const items=run.plan.filter(p=>!selected||selected.includes(`${p.version}/${p.repository}`));
   for(const item of items){if(this.deleting.has(id))break;const key=`${item.version}/${item.repository}`;if(run.claimed.includes(key))continue;
    // Reusing any unfinished/MR-bearing workspace would replay external side effects.
    await this.autoUt.refreshDeletedMrs(item.repository,item.version,item.baseBranch);if(this.deleting.has(id))break;
    if(this.autoUt.blocksRepository(item.repository,item.version,item.baseBranch)){run.messages.push(`${key}：已有执行记录，跳过；请在原任务中继续或处理 MR`);this.save(run);continue;}
    run.claimed.push(key);this.save(run);
    const row:QualityRow={'代码仓':item.repository,'语言':'Java','PL组':'Access_智能驾舱组','失败用例':item.failedTests,'行覆盖率':item.lineCoverage,'行覆盖率目标':item.lineGoal,'分支覆盖率':item.branchCoverage,'分支覆盖率目标':item.branchGoal};
    try{const tasks=await this.autoUt.start(Buffer.from(qualityCsv({columns:Object.keys(row),rows:[row]})),run.config.username,run.config.ticket,item.baseBranch,run.config.workspaceRoot,mode,{version:item.version,reportId:run.id,maxClasses:run.config.maxClasses??5,reportAt:run.createdAt});run.taskIds.push(...tasks.map(t=>t.id));run.messages.push(`${key}：已创建修复任务`);}catch{run.messages.push(`${key}：启动失败，请检查工作目录；本次不会自动重试`);}this.save(run);
   }
   if(!items.length){run.messages.push('没有符合条件的 Java 异常仓库，未启动修复');this.save(run);}return run;
  }finally{this.starting=false;}
 }
 async tick(now=new Date()){
  const saved=this.configuration();if(!saved.config.schedule.enabled||!saved.nextRunAt||now.getTime()<Date.parse(saved.nextRunAt))return;
  const due=Date.parse(saved.nextRunAt);saved.nextRunAt=nextRun(saved.config,now);this.store.putRecord('auto-ut-report-config','main',saved);
  if(now.getTime()-due>60000||this.fetching||this.starting){this.logs.task('auto-ut','report-scheduler',{time:now.toISOString(),message:'跳过错过的时间点或重叠的报告任务'});return;}
  this.fetchReport('SCHEDULE');
 }
}
export function autoUtReportRoutes(app:FastifyInstance,service:AutoUtReports,schedules?:UnifiedSchedules){app.get('/api/auto-ut/report-settings',async()=>service.configuration());app.put('/api/auto-ut/report-settings',async req=>schedules?schedules.saveLegacyOnline(req.body):service.configure(req.body));app.post('/api/auto-ut/reports',async(_req,reply)=>reply.code(202).send(service.fetchReport()));app.get('/api/auto-ut/reports',async()=>service.list());app.get('/api/auto-ut/reports/:id',async req=>service.get(z.object({id:z.uuid()}).parse(req.params).id));app.post('/api/auto-ut/reports/:id/tasks',async(req,reply)=>{const{id}=z.object({id:z.uuid()}).parse(req.params),body=z.object({mode:z.enum(['MANUAL','AUTOMATIC']).default('AUTOMATIC'),selected:z.array(z.string().max(160)).min(1).max(1000).optional()}).parse(req.body);return reply.code(202).send(await service.start(id,body.mode,body.selected));});}
