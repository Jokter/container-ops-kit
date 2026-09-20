import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {QualityService,qualityInput,qualitySql,utColumns,normalizeQuality,qualityCsv} from '../src/modules/quality/quality.js';
import {AutoUtService,autoUtWorkspace,type AutoUtTask} from '../src/modules/autout/autout.js';
import {AutoUtReports,nextRun,reportConfig,reportDate} from '../src/modules/autout/reports.js';
const row=['Demo','Java','Access_智能驾舱组',1,.5,.9,.5,.9,100,20];
const payload=(rows:unknown[][])=>({results:{A:{tables:[{columns:utColumns.map(text=>({text})),rows}]}}});
const config=()=>reportConfig.parse({versions:[{version:'R27C10',baseBranch:'release/27'},{version:'R27C00',baseBranch:'release/26'}],dateMode:'yesterday',username:'tester',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:00',timezone:'Asia/Shanghai',action:'FETCH'}});
const input=qualityInput.parse({versions:['R27C10','R27C00'],date:'2026-09-20',domain:'Access',teams:['Access_智能驾舱组'],kinds:['ut']});
test('UT 门禁与脚本一致；缺失指标不能误判通过；CSV 转义公式',()=>{
 const result=normalizeQuality(payload([row,['Passed','Java','Access_智能驾舱组',0,.8,.95,.7,.99,100,20],['NoData','Java','Access_智能驾舱组',0,0,0,0,0,0,0],['Cpp','Cpp','Access_智能驾舱组',0,.5,.8,null,null,100,null]]),'ut');
 assert.equal(result.sourceCount,4);assert.equal(result.eligibleCount,3);assert.equal(result.rows.length,2);assert.equal(result.rows[0]!['待补充行数'],30);
 assert.throws(()=>normalizeQuality(payload([['Broken','Java','Access_智能驾舱组',0,null,.8,.7,.7,100,20]]),'ut'),/缺失/);
 assert.throws(()=>normalizeQuality({results:{A:{error:'sql error'}}},'ut'),/数据源/);
 assert.match(qualityCsv({columns:['name'],rows:[{name:'=CMD()'}]}),/'=CMD/);
});
test('限定 SQL 的版本和团队；静态检查排除构建仓且保留零记录团队',()=>{
 assert.throws(()=>qualityInput.parse({...input,versions:['R27C10;DROP']}));assert.throws(()=>qualityInput.parse({...input,teams:["x' or 1=1"]}));
 const sql=qualitySql(input,'R27C10','static');assert.match(sql,/R27C10_lint/);assert.match(sql,/BuildPackageWorkaround/);assert.doesNotMatch(sql,/report_date/);
});
test('分版本保留部分成功、有效空报告与进度；请求采用实际连接配置',async()=>{
 const store=new TaskStore(':memory:');let calls=0;const service=new QualityService(store,undefined,async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body)) as {queries:{rawSql:string;datasourceId:number}[]};assert.equal(body.queries[0]!.datasourceId,4);return body.queries[0]!.rawSql.includes('R27C00')?new Response('no',{status:500}):Response.json(payload([]));});
 try{const job=service.start(input);const done=await service.wait(job.id);assert.equal(done.status,'PARTIAL');assert.equal(done.parts[0]!.status,'EMPTY');assert.equal(done.parts[1]!.status,'FAILED');assert.equal(calls,2);}finally{await service.close();store.close();}
});
test('每周/工作日时区计算与相对报告日期，不依赖服务器时区',()=>{
 const c=config();assert.equal(nextRun(c,new Date('2026-09-18T02:00:00Z')),'2026-09-21T01:00:00.000Z');assert.equal(reportDate(c,new Date('2026-09-20T17:00:00Z')),'2026-09-20');c.schedule.frequency='weekly';c.schedule.weekday=0;assert.equal(nextRun(c,new Date('2026-09-20T00:00:00Z')),'2026-09-20T01:00:00.000Z');
});
class FakeAutoUt extends AutoUtService{
 calls:Array<{branch:string;version:string;report:Buffer}>=[];records:AutoUtTask[]=[];
 override tasks(){return this.records??[];}
 override async start(report:Buffer,username:string,ticket:string,baseBranch:string,workspaceRoot:string,executionMode:'MANUAL'|'AUTOMATIC',source?:{version:string;reportId:string}){
  assert.ok(source);this.calls.push({branch:baseBranch,version:source.version,report});const task:AutoUtTask={id:String(this.calls.length),reportVersion:source.version,sourceReportId:source.reportId,repository:'Demo',username,ticket,baseBranch,repairBranch:baseBranch+'_'+source.version,workspaceRoot,executionMode,status:'WAITING_CONFIRMATION',nextStage:'PREPARE',progress:0,attempts:0,message:'',pullRequestUrl:'',createdAt:'',updatedAt:'',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,history:[],liveEvents:[],liveSequence:0};this.records.push(task);return[task];
 }
}
async function ready(reports:AutoUtReports,id:string){for(let i=0;i<100;i++){const r=reports.get(id);if(r.status!=='FETCHING')return r;await new Promise(r=>setTimeout(r,2));}throw new Error('报告未就绪');}
test('Auto-UT 获取多版本新报告；按分支创建并防止重复启动',async()=>{
 const store=new TaskStore(':memory:');let fetches=0;const quality=new QualityService(store,undefined,async()=>{fetches++;return Response.json(payload([row]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{reports.configure(config());const run=await ready(reports,reports.fetchReport().id);assert.equal(run.plan.length,2);assert.deepEqual(run.plan.map(p=>p.baseBranch),['release/27','release/26']);assert.equal(run.plan[0]!.lineGoal,.8);assert.equal(run.plan[0]!.branchGoal,.7);await reports.start(run.id,'MANUAL');assert.deepEqual(auto.calls.map(c=>c.version),['R27C10','R27C00']);await reports.start(run.id,'MANUAL');assert.equal(auto.calls.length,2);
 const fresh=await ready(reports,reports.fetchReport().id);assert.equal(fetches,4);await reports.start(fresh.id,'AUTOMATIC');assert.equal(auto.calls.length,2);assert.match(reports.get(fresh.id).messages.join(),/已有执行记录/);
 }finally{await quality.close();await reports.close();auto.close();store.close();}
});
test('定时触发重新查询、同一时间点不重放；错过时间点不补跑',async()=>{
 const store=new TaskStore(':memory:');let count=0;const quality=new QualityService(store,undefined,async()=>{count++;return Response.json(payload([]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{const c=config();c.schedule.enabled=true;reports.configure(c);store.putRecord('auto-ut-report-config','main',{config:c,nextRunAt:'2026-09-21T01:00:00.000Z'});await reports.tick(new Date('2026-09-21T01:00:05Z'));await ready(reports,reports.list()[0]!.id);await reports.tick(new Date('2026-09-21T01:00:15Z'));assert.equal(count,2);await reports.tick(new Date('2026-09-23T02:00:00Z'));assert.equal(count,2);assert.equal(auto.calls.length,0);assert.throws(()=>reports.configure({...c,versions:[c.versions[0],c.versions[0]]}));
 }finally{await quality.close();await reports.close();auto.close();store.close();}
});

test('同仓库多个版本使用独立工作目录，旧 CSV 任务路径保持兼容',()=>{assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo',reportVersion:'R27C10'}),'/tmp/work/R27C10/demo');assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo',reportVersion:'R27C00'}),'/tmp/work/R27C00/demo');assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo'}),'/tmp/work/demo');});

test('定时自动修复只消费成功版本，部分失败保留诊断信息',async()=>{
 const store=new TaskStore(':memory:');const quality=new QualityService(store,undefined,async(_url,init)=>String(init?.body).includes('R27C00')?new Response('',{status:503}):Response.json(payload([row]))),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{const c=config();c.schedule.enabled=true;c.schedule.action='REPAIR';reports.configure(c);const run=reports.fetchReport('SCHEDULE');await ready(reports,run.id);for(let n=0;n<100&&!auto.calls.length;n++)await new Promise(r=>setTimeout(r,2));assert.deepEqual(auto.calls.map(c=>c.version),['R27C10']);assert.equal(reports.get(run.id).status,'PARTIAL');assert.match(reports.get(run.id).messages.join(),/503/);}finally{await quality.close();await reports.close();auto.close();store.close();}
});
test('重启标记未完成查询，不重放外部任务；暂停清除下次执行时间',async()=>{
 const store=new TaskStore(':memory:');store.putRecord('auto-ut-report-run','unfinished',{id:'unfinished',status:'FETCHING',createdAt:'2026-01-01',messages:[],taskIds:[]});let queries=0;const quality=new QualityService(store,undefined,async()=>{queries++;return Response.json(payload([]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{assert.equal(reports.get('unfinished').status,'INTERRUPTED');assert.equal(queries,0);const c=config();c.schedule.enabled=true;assert.ok(reports.configure(c).nextRunAt);c.schedule.enabled=false;assert.equal(reports.configure(c).nextRunAt,null);}finally{await quality.close();await reports.close();auto.close();store.close();}
});
