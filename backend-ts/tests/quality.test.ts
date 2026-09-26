import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {QualityService,qualityInput,qualitySql,utColumns,normalizeQuality,qualityCsv} from '../src/modules/quality/quality.js';
import {AutoUtService,autoUtWorkspace,type AutoUtTask} from '../src/modules/autout/autout.js';
import {AutoUtReports,nextRun,reportConfig,reportDate} from '../src/modules/autout/reports.js';
const row=['Demo','Java','Access_智能驾舱组',1,.5,.9,.5,.9,100,20];
const payload=(rows:unknown[][])=>({results:{A:{tables:[{columns:utColumns.map(text=>({text})),rows}]}}});
const config=()=>reportConfig.parse({versions:[{version:'R27C10',baseBranch:'release/27',ticket:'DTS1'},{version:'R27C00',baseBranch:'release/26',ticket:'DTS2'}],dateMode:'yesterday',username:'tester',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:00',timezone:'Asia/Shanghai',action:'FETCH'}});
const input=qualityInput.parse({versions:['R27C10','R27C00'],date:'2026-09-20',domain:'Access',teams:['Access_智能驾舱组'],kinds:['ut']});
test('UT 门禁与脚本一致；缺失指标不能误判通过；CSV 转义公式',()=>{
 const result=normalizeQuality(payload([row,['Passed','Java','Access_智能驾舱组',0,.8,.95,.7,.99,100,20],['NoData','Java','Access_智能驾舱组',0,0,0,0,0,0,0],['Cpp','Cpp','Access_智能驾舱组',0,.5,.8,null,null,100,null]]),'ut');
 assert.equal(result.sourceCount,4);assert.equal(result.eligibleCount,3);assert.equal(result.rows.length,2);assert.equal(result.rows[0]!['待补充行数'],30);
 assert.throws(()=>normalizeQuality(payload([['Broken','Java','Access_智能驾舱组',0,null,.8,.7,.7,100,20]]),'ut'),/缺失/);
 assert.throws(()=>normalizeQuality({results:{A:{error:'sql error'}}},'ut'),/数据源/);
 assert.match(qualityCsv({columns:['name'],rows:[{name:'=CMD()'}]}),/'=CMD/);
});
test('UT 报告将百分数字符串标准化为比例数值',()=>{
 const result=normalizeQuality(payload([['Percent','Java','Access_智能驾舱组',1,'75.5%','80%','60%','70%',100,20]]),'ut');
 assert.equal(result.rows[0]?.['行覆盖率'],.755);assert.equal(result.rows[0]?.['行覆盖率目标'],.8);
 assert.equal(result.rows[0]?.['分支覆盖率'],.6);assert.equal(result.rows[0]?.['分支覆盖率目标'],.7);
});
test('限定 SQL 的版本和团队；静态检查排除构建仓且保留零记录团队',()=>{
 assert.throws(()=>qualityInput.parse({...input,versions:['R27C10;DROP']}));assert.throws(()=>qualityInput.parse({...input,teams:["x' or 1=1"]}));
 const sql=qualitySql(input,'R27C10','static');assert.match(sql,/R27C10_lint/);assert.match(sql,/BuildPackageWorkaround/);assert.doesNotMatch(sql,/report_date/);
 const latest=qualitySql({...input,latest:true},'R27C10','ut');assert.match(latest,/report_date=\(select max\(report_date\)/);assert.doesNotMatch(latest,/report_date='2026-09-20'/);
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
test('Auto-UT 获取每个版本的最新报告；按分支创建并防止重复启动',async()=>{
 const store=new TaskStore(':memory:');let fetches=0;const quality=new QualityService(store,undefined,async(_url,init)=>{fetches++;const body=JSON.parse(String(init?.body)) as {queries:Array<{rawSql:string}>};assert.match(body.queries[0]!.rawSql,/max\(report_date\)/);return Response.json(payload([row]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{reports.configure(config());const run=await ready(reports,reports.fetchReport().id);assert.equal(run.plan.length,2);assert.deepEqual(run.plan.map(p=>p.baseBranch),['release/27','release/26']);assert.equal(run.plan[0]!.lineGoal,.8);assert.equal(run.plan[0]!.branchGoal,.7);await reports.start(run.id,'MANUAL');assert.deepEqual(auto.calls.map(c=>c.version),['R27C10','R27C00']);assert.deepEqual(auto.records.map(t=>t.ticket),['DTS1','DTS2']);await reports.start(run.id,'MANUAL');assert.equal(auto.calls.length,2);
 assert.throws(()=>reports.fetchReport(),/已有 UT 修复任务/);assert.equal(fetches,2);assert.equal(auto.calls.length,2);
 }finally{await quality.close();await reports.close();auto.close();store.close();}
});
test('定时触发重新查询、同一时间点不重放；错过时间点不补跑',async()=>{
 const store=new TaskStore(':memory:');let count=0;const quality=new QualityService(store,undefined,async()=>{count++;return Response.json(payload([]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{const c=config();c.schedule.enabled=true;reports.configure(c);store.putRecord('auto-ut-report-config','main',{config:c,nextRunAt:'2026-09-21T01:00:00.000Z'});await reports.tick(new Date('2026-09-21T01:00:05Z'));await ready(reports,reports.list()[0]!.id);await reports.tick(new Date('2026-09-21T01:00:15Z'));assert.equal(count,2);await reports.tick(new Date('2026-09-23T02:00:00Z'));assert.equal(count,2);assert.equal(auto.calls.length,0);assert.throws(()=>reports.configure({...c,versions:[c.versions[0],c.versions[0]]}));
 }finally{await quality.close();await reports.close();auto.close();store.close();}
});

test('同仓库多个版本使用独立工作目录，旧 CSV 任务路径保持兼容',()=>{assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo',reportVersion:'R27C10'}),'/tmp/work/R27C10/demo');assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo',reportVersion:'R27C00'}),'/tmp/work/R27C00/demo');assert.equal(autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo'}),'/tmp/work/demo');assert.throws(()=>autoUtWorkspace({workspaceRoot:'/tmp/work',repository:'Demo',reportVersion:'../escape'}),/版本/);});

test('定时自动修复只消费成功版本，部分失败保留诊断信息',async()=>{
 const store=new TaskStore(':memory:');const quality=new QualityService(store,undefined,async(_url,init)=>String(init?.body).includes('R27C00')?new Response('',{status:503}):Response.json(payload([row]))),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{const c=config();c.schedule.enabled=true;c.schedule.action='REPAIR';reports.configure(c);const run=reports.fetchReport('SCHEDULE');await ready(reports,run.id);for(let n=0;n<100&&!auto.calls.length;n++)await new Promise(r=>setTimeout(r,2));assert.deepEqual(auto.calls.map(c=>c.version),['R27C10']);assert.equal(reports.get(run.id).status,'PARTIAL');assert.match(reports.get(run.id).messages.join(),/503/);}finally{await quality.close();await reports.close();auto.close();store.close();}
});
test('重启标记未完成查询，不重放外部任务；暂停清除下次执行时间',async()=>{
 const store=new TaskStore(':memory:');store.putRecord('auto-ut-report-run','unfinished',{id:'unfinished',status:'FETCHING',createdAt:'2026-01-01',messages:[],taskIds:[]});let queries=0;const quality=new QualityService(store,undefined,async()=>{queries++;return Response.json(payload([]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{assert.equal(reports.get('unfinished').status,'INTERRUPTED');assert.equal(queries,0);const c=config();c.schedule.enabled=true;assert.ok(reports.configure(c).nextRunAt);c.schedule.enabled=false;assert.equal(reports.configure(c).nextRunAt,null);}finally{await quality.close();await reports.close();auto.close();store.close();}
});

test('按版本报告拦截建单，绑定新单后使用原报告启动，不依赖其他版本单号',async()=>{
 const store=new TaskStore(':memory:');let calls=0;
 const quality=new QualityService(store,undefined,async(_url,init)=>{calls++;return Response.json(payload(String(init?.body).includes('R27C00')?[]:[row]));}),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{
  const c=config();c.versions.forEach(v=>v.ticket='');c.ticket='';reports.configure(c);
  const run=await ready(reports,reports.fetchReport().id);
  assert.throws(()=>reports.assertCanCreate(run.id,'R27C00','tester'),/没有已确认/);
  assert.throws(()=>reports.assertCanCreate(run.id,'R27C10','other'),/执行配置/);
  assert.equal(reports.assertCanCreate(run.id,'R27C10','tester').id,run.id);
  store.putRecord('dts-ticket','ticket',{username:'tester',version:'R27C10',ticket:'DTSNEW',status:'REVIEW'});
  assert.throws(()=>reports.bindTicket(run.id,'R27C10','tester','DTSNEW'),/尚未确认/);
  store.putRecord('dts-ticket','ticket',{username:'tester',version:'R27C10',ticket:'DTSNEW',status:'READY'});
  reports.bindTicket(run.id,'R27C10','tester','DTSNEW');
  await reports.start(run.id,'AUTOMATIC',['R27C10/Demo'],true);
  assert.equal(auto.records[0]!.ticket,'DTSNEW');assert.equal(calls,2);
  assert.throws(()=>reports.assertCanCreate(run.id,'R27C10','tester'),/已有 UT/);
  const next=await ready(reports,reports.fetchReport().id);assert.deepEqual(next.config.versions.map(v=>v.version),['R27C00']);assert.equal(calls,3);
  await reports.start(run.id,'AUTOMATIC',['R27C10/Demo'],true);assert.equal(auto.calls.length,1);
 }finally{await reports.close();await quality.close();await auto.close();store.close();}
});
test('失败报告和正常指标不能建单或触发修复，分支变化要求重新获取',async()=>{
 const store=new TaskStore(':memory:');let failed=true;
 const quality=new QualityService(store,undefined,async()=>failed?new Response('',{status:503}):Response.json(payload([['Demo','Java','Access_智能驾舱组',0,1,.9,1,.9,100,20]]))),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{reports.configure(config());let run=await ready(reports,reports.fetchReport().id);assert.throws(()=>reports.assertCanCreate(run.id,'R27C10','tester'),/没有已确认/);
 failed=false;run=await ready(reports,reports.fetchReport().id);assert.equal(run.plan.length,0);assert.throws(()=>reports.assertCanCreate(run.id,'R27C10','tester'),/没有已确认/);assert.equal(auto.calls.length,0);
 }finally{await reports.close();await quality.close();await auto.close();store.close();}
});

for(const status of ['RESOLVED','NO_CHANGE','MR_CLOSED'] as const)test(status+'旧任务保留历史，新报告可再次治理且同报告不重放',async()=>{
 const store=new TaskStore(':memory:'),quality=new QualityService(store,undefined,async()=>Response.json(payload([row]))),auto=new FakeAutoUt(store),reports=new AutoUtReports(store,quality,auto);
 try{
  reports.configure(config());const first=await reports.wait(reports.fetchReport('MANUAL',undefined,['R27C10']).id);
  await reports.start(first.id,'MANUAL');const old=auto.records[0]!;old.status=status;old.nextStage='DONE';
  assert.equal(reports.versionLocked('R27C10','release/27'),false);
  const next=await reports.wait(reports.fetchReport('MANUAL',undefined,['R27C10']).id);
  assert.notEqual(next.id,first.id);reports.assertCanCreate(next.id,'R27C10','tester');
  await reports.start(next.id,'MANUAL');await reports.start(next.id,'MANUAL');
  assert.equal(auto.calls.length,2);assert.equal(auto.records[0]!.status,status);assert.equal(auto.records[1]!.sourceReportId,next.id);
  assert.equal(reports.versionLocked('R27C10','release/27'),true);
 }finally{await reports.close();await quality.close();auto.close();store.close();}
});
