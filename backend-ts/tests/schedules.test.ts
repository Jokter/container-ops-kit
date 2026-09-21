import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {QualityService,utColumns} from '../src/modules/quality/quality.js';
import {AutoUtService} from '../src/modules/autout/autout.js';
import {AutoUtReports,reportConfig} from '../src/modules/autout/reports.js';
import {UnifiedSchedules,type ManagedSchedule,type ScheduleRun} from '../src/modules/automation/schedules.js';
const payload={results:{A:{tables:[{columns:utColumns.map(text=>({text})),rows:[]}]}}};
const qualityPlan=()=>({name:'每日质量检查',enabled:true,timing:{frequency:'daily',weekday:1,time:'09:00',timezone:'Asia/Shanghai'},task:{kind:'quality',dateMode:'yesterday',query:{versions:['R27C10','R27C00'],domain:'Access',teams:['Access_智能驾舱组'],kinds:['ut']}}});
function fixture(request:typeof fetch=async()=>Response.json(payload)){
 const store=new TaskStore(':memory:'),quality=new QualityService(store,undefined,request),auto=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,auto,undefined,false),schedules=new UnifiedSchedules(store,quality,reports,auto);
 return{store,quality,auto,reports,schedules,close:async()=>{schedules.stop();await quality.close();await reports.close();await schedules.close();auto.close();store.close();}};
}
test('质量计划按时区查询相对日期，并保留配置快照与报告链接',async()=>{
 const sqls:string[]=[];const f=fixture(async(_url,init)=>{sqls.push(String(init?.body));return Response.json(payload);});
 try{const s=f.schedules.create(qualityPlan());const run=f.schedules.runNow(s.id);await f.schedules.wait(s.id);const done=f.schedules.runs(s.id)[0]!;assert.equal(done.status,'SUCCEEDED');assert.ok(done.jobId);assert.equal(run.trigger,'MANUAL');assert.equal(sqls.length,2);assert.deepEqual(f.quality.get(done.jobId!).input.versions,['R27C10','R27C00']);assert.ok(done.snapshot);const paused=f.schedules.toggle(s.id,false,s.revision);assert.equal(paused.nextRunAt,null);assert.equal(paused.enabled,false);assert.throws(()=>f.schedules.update(s.id,qualityPlan(),s.revision),/已被修改/);f.schedules.delete(s.id,paused.revision);assert.equal(f.schedules.list().length,0);assert.equal(f.schedules.runs(s.id).length,1);}finally{await f.close();}
});
test('同计划不可重叠执行；暂停不取消正在执行的查询',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});const f=fixture(async()=>{await gate;return Response.json(payload);});
 try{const s=f.schedules.create(qualityPlan());f.schedules.runNow(s.id);assert.throws(()=>f.schedules.runNow(s.id),/正在执行/);const paused=f.schedules.toggle(s.id,false,s.revision);assert.equal(paused.running,true);assert.throws(()=>f.schedules.delete(s.id,paused.revision),/正在执行/);const skipped=f.schedules.runNow(s.id,'SCHEDULE');assert.equal(skipped.status,'SKIPPED');release();await f.schedules.wait(s.id);assert.ok(f.schedules.runs(s.id).some(r=>r.status==='SUCCEEDED'));assert.equal(f.schedules.get(s.id).enabled,false);}finally{release();await f.close();}
});
test('定时触发先领取时间点，重复 tick 不重放，错过记录跳过',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json(payload);});
 try{const s=f.schedules.create(qualityPlan()),raw=f.store.getRecord<ManagedSchedule>('automation-schedule',s.id)!;raw.nextRunAt='2026-09-21T01:00:00.000Z';f.store.putRecord('automation-schedule',s.id,raw);f.schedules.tick(new Date('2026-09-21T01:00:10Z'));await f.schedules.wait(s.id);f.schedules.tick(new Date('2026-09-21T01:00:20Z'));assert.equal(calls,2);f.schedules.tick(new Date('2026-09-23T03:00:00Z'));assert.equal(calls,2);assert.ok(f.schedules.runs(s.id).some(r=>r.status==='SKIPPED'));}finally{await f.close();}
});
test('原在线与 CSV 计划只迁移一次；CSV 内容不出现在列表或快照',async()=>{
 const store=new TaskStore(':memory:'),quality=new QualityService(store,undefined,async()=>Response.json(payload)),auto=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,auto,undefined,false);
 const config=reportConfig.parse({versions:[{version:'R27C10',baseBranch:'release'}],dateMode:'today',username:'u',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:true,frequency:'daily',weekday:1,time:'09:00',timezone:'Asia/Shanghai',action:'FETCH'}});
 reports.configure(config);auto.saveSchedule({report:'SECRET_CSV_BYTES',reportFileName:'report.csv',username:'u',ticket:'DTS1',baseBranch:'main',workspaceRoot:'/tmp',dailyTime:'10:00'});
 const first=new UnifiedSchedules(store,quality,reports,auto);try{assert.equal(first.list().length,2);assert.doesNotMatch(JSON.stringify(first.list()),/SECRET_CSV_BYTES/);const csv=first.list().find(s=>s.task.kind==='csv')!;first.toggle(csv.id,false,csv.revision);assert.equal(auto.getSchedule(),undefined);await first.close();const second=new UnifiedSchedules(store,quality,reports,auto);assert.equal(second.list().length,2);assert.equal(second.get(csv.id).enabled,false);await second.close();}finally{await first.close();await quality.close();await reports.close();auto.close();store.close();}
});
test('多条在线计划使用各自版本快照，不覆盖手动查询配置',async()=>{
 const f=fixture();try{const original=f.reports.configuration().config;const config={...original,versions:[{version:'R26C10',baseBranch:'old'}]};const s=f.schedules.create({...qualityPlan(),name:'仅获取旧版 UT',task:{kind:'auto-ut',config}});f.schedules.runNow(s.id);await f.schedules.wait(s.id);const done=f.schedules.runs(s.id)[0]!;assert.ok(done.reportId);assert.deepEqual(f.reports.get(done.reportId!).config.versions,config.versions);assert.deepEqual(f.reports.configuration().config.versions,original.versions);assert.equal(done.status,'SUCCEEDED');}finally{await f.close();}
});
test('重启后未完成记录中断，不重放任务',async()=>{
 const f=fixture();try{const s=f.schedules.create(qualityPlan());const record:ScheduleRun={id:'interrupted',scheduleId:s.id,name:s.name,kind:'quality',trigger:'SCHEDULE',status:'RUNNING',createdAt:new Date().toISOString(),finishedAt:null,message:'',taskIds:[],snapshot:{}};f.store.putRecord('automation-schedule-run',record.id,record);await f.schedules.close();const next=new UnifiedSchedules(f.store,f.quality,f.reports,f.auto);assert.equal(next.runs(s.id)[0]!.status,'INTERRUPTED');assert.equal(f.quality.list().length,0);await next.close();}finally{await f.close();}
});
