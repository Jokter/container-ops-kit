import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,stat,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {TaskStore} from '../src/platform/store.js';
import {QualityService} from '../src/modules/quality/quality.js';
import {AutoUtReports,reportConfig} from '../src/modules/autout/reports.js';
import {AutoUtService,autoUtWorkspace,type AutoUtTask} from '../src/modules/autout/autout.js';
import {AutomationRecords} from '../src/modules/automation/records.js';
const query={versions:['R27C10','R27C00'],date:'2026-09-22',domain:'Access',teams:['Access_智能驾舱组'],kinds:['ut']};
const config=reportConfig.parse({dateMode:'yesterday',versions:[{version:'R27C10',baseBranch:'master'}],username:'tester',ticket:'DTS1',workspaceRoot:'/tmp',schedule:{enabled:false,frequency:'weekdays',weekday:1,time:'09:30',timezone:'Asia/Shanghai',action:'REPAIR'}});
test('删除运行中的质量查询：中止请求，不再启动排队分片，其他任务不受影响',async()=>{
 const store=new TaskStore(':memory:');let calls=0,aborts=0;
 const quality=new QualityService(store,undefined,async(_url,options)=>{calls++;return new Promise<Response>((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>{aborts++;reject(new Error('aborted'));},{once:true});});});
 try{quality.saveConnection({...quality.connection(),parallel:1});const first=quality.start(query),other=quality.start(query);await quality.remove(first.id);assert.equal(aborts,1);assert.equal(calls,2);assert.equal(quality.list().length,1);assert.equal(quality.get(other.id).status,'RUNNING');await quality.remove(first.id);assert.equal(quality.list().length,1);}finally{await quality.close();store.close();}
});
test('删除获取中的自动报告：中止质量请求并等待完成，不能继续自动修复或复活记录',async()=>{
 const store=new TaskStore(':memory:');let aborted=false;
 const quality=new QualityService(store,undefined,async(_url,options)=>new Promise<Response>((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});}));
 const autoUt=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,autoUt,undefined,false),records=new AutomationRecords(autoUt,reports,quality);
 try{const run=reports.fetchReport('SCHEDULE',config);const result=await records.cleanup({entries:[{kind:'report',id:run.id}]});assert.equal(result.failed.length,0);assert.equal(aborted,true);assert.equal(reports.list().length,0);assert.equal(quality.list().length,1);assert.equal(quality.list()[0]!.status,'INTERRUPTED');assert.equal(autoUt.tasks().length,0);}finally{await quality.close();await reports.close();await autoUt.close();store.close();}
});
test('待合入记录清理会等待当前执行停止，清理代码和会话、保留成果，刷新不再出现且 MR 仍阻止重复建单',async()=>{
 const root=await mkdtemp(join(tmpdir(),'record-delete-')),file=join(root,'keep.txt');await writeFile(file,'keep');
 const store=new TaskStore(':memory:'),autoUt=new AutoUtService(store,undefined,false),quality=new QualityService(store),reports=new AutoUtReports(store,quality,autoUt,undefined,false),records=new AutomationRecords(autoUt,reports,quality);
 const task:AutoUtTask={id:'11111111-1111-4111-8111-111111111111',repository:'Demo',reportVersion:'R27C10',username:'tester',ticket:'DTS1',baseBranch:'master',repairBranch:'fix',workspaceRoot:root,executionMode:'AUTOMATIC',status:'MR_PENDING',nextStage:'TRACK',progress:92,attempts:0,message:'等待合入',pullRequestUrl:'https://example.com/merge_requests/1',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reportedFailedTests:1,lineGoal:.8,branchGoal:.7,history:[],liveEvents:[],liveSequence:0,governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'PENDING',fixedIds:['A#test']}};
 try{const workspace=autoUtWorkspace(task),session=autoUt['piSessionFile'](task);await mkdir(join(workspace,'.git'),{recursive:true});await writeFile(join(workspace,'pom.xml'),'<project/>');await mkdir(dirname(session),{recursive:true});await writeFile(session,'session');autoUt['save'](task);const controller=new AbortController();autoUt['controllers'].set(task.id,controller);let stopped=false;autoUt['executions'].set(task.id,new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>{stopped=true;autoUt['save'](task);resolve();},{once:true})));
 const result=await records.cleanup({entries:[{kind:'ut',id:task.id},{kind:'ut',id:task.id}]});assert.equal(stopped,true);await assert.rejects(stat(workspace));await assert.rejects(stat(session));assert.equal(result.deleted.length,1);assert.equal(result.failed.length,0);assert.equal(autoUt.tasks().length,0);assert.equal(autoUt.governanceSummary().records.length,0);assert.equal(autoUt.governanceSummary().metrics.fixedCases,1);assert.equal(autoUt.blocksRepository('Demo','R27C10','master'),true);assert.equal(await readFile(file,'utf8'),'keep');await records.cleanup({entries:[{kind:'ut',id:task.id}]});assert.equal(autoUt.governanceSummary().records.length,0);
 const child={...task,id:'66666666-6666-4666-8666-666666666666',repository:'Child',sourceReportId:'77777777-7777-4777-8777-777777777777'};autoUt['save'](child);await mkdir(autoUtWorkspace(child),{recursive:true});await writeFile(join(autoUtWorkspace(child),'pom.xml'),'<project/>');store.putRecord('auto-ut-report-run',child.sourceReportId,{id:child.sourceReportId,jobId:'88888888-8888-4888-8888-888888888888',trigger:'MANUAL',status:'READY',createdAt:task.createdAt,config,plan:[],taskIds:[child.id],messages:[],claimed:[]});const removed=await records.cleanup({entries:[{kind:'report',id:child.sourceReportId}]});assert.equal(removed.failed.length,0);assert.ok(await stat(autoUtWorkspace(child)));assert.equal(autoUt.get(child.id).id,child.id);assert.equal(await readFile(file,'utf8'),'keep');
 }finally{await quality.close();await reports.close();await autoUt.close();store.close();await rm(root,{recursive:true,force:true});}
});
test('批量清理保留逐项失败结果，并继续清理其他类型；校验非法输入',async()=>{
 const store=new TaskStore(':memory:'),quality=new QualityService(store),autoUt=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,autoUt,undefined,false),records=new AutomationRecords(autoUt,reports,quality);
 try{autoUt.removeExecutionRecord=async()=>{throw new Error('进程未退出');};const result=await records.cleanup({entries:[{kind:'ut',id:'11111111-1111-4111-8111-111111111111'},{kind:'quality',id:'22222222-2222-4222-8222-222222222222'}]});assert.equal(result.failed[0]?.message,'进程未退出');assert.equal(result.deleted[0]?.kind,'quality');await assert.rejects(records.cleanup({entries:[{kind:'shell',id:'bad'}]}));}finally{await quality.close();await reports.close();await autoUt.close();store.close();}
});

test('报告在创建子任务过程中被删除：等待当前创建结束，不再创建下一仓库',async()=>{
 const store=new TaskStore(':memory:'),quality=new QualityService(store),autoUt=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,autoUt,undefined,false);
 const id='33333333-3333-4333-8333-333333333333';
 const plan=['Demo','Second'].map(repository=>({repository,version:'R27C10',baseBranch:'master',failedTests:1,lineCoverage:.5,lineGoal:.8,branchCoverage:.5,branchGoal:.7,configured:true,repositoryUrl:'ssh://example/demo',repositoryCustomized:false,repairBranch:'fix'}));
 store.putRecord('auto-ut-report-run',id,{id,jobId:'44444444-4444-4444-8444-444444444444',trigger:'MANUAL',status:'READY',createdAt:new Date().toISOString(),config,plan,taskIds:[],messages:[],claimed:[]});
 let enter=()=>{},resume=()=>{};const entered=new Promise<void>(resolve=>{enter=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});let calls=0;
 autoUt.start=async()=>{calls++;enter();await release;return[];};
 try{const work=reports.start(id,'AUTOMATIC');await entered;const removal=reports.remove(id);resume();await Promise.all([work,removal]);assert.equal(calls,1);assert.equal(reports.list().length,0);}finally{await quality.close();await reports.close();await autoUt.close();store.close();}
});
test('重新治理前核对已删除任务的待合入 MR，避免隐藏记录永久阻塞',async()=>{
 const store=new TaskStore(':memory:'),autoUt=new AutoUtService(store,undefined,false);const id='55555555-5555-4555-8555-555555555555';
 const record={id,repository:'Demo',reportVersion:'R27C10',baseBranch:'master',status:'MR_PENDING',message:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pullRequestUrl:'https://example.com/merge_requests/1',governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'PENDING'}};
 store.putRecord('auto-ut-governance',id,record);store.putRecord('automation-record-hidden',id,{id});let checked=0;
 autoUt.resolveMr=async target=>{assert.equal(target,id);checked++;const saved=autoUt.governanceRecords()[0]!;saved.governance.mrState='MERGED';saved.status='RESOLVED';store.putRecord('auto-ut-governance',id,saved);return saved;};
 try{assert.equal(autoUt.blocksRepository('Demo','R27C10','master'),true);await autoUt.refreshDeletedMrs('Other','R27C10','master');assert.equal(checked,0);await autoUt.refreshDeletedMrs('Demo','R27C10','master');assert.equal(checked,1);assert.equal(autoUt.blocksRepository('Demo','R27C10','master'),false);assert.equal(autoUt.governanceSummary().records.length,0);}finally{await autoUt.close();store.close();}
});

test('隐藏 MR 核验失败隔离到对应仓库，手动解除保留远端状态和审计',async()=>{
 const store=new TaskStore(':memory:'),autoUt=new AutoUtService(store,undefined,false),quality=new QualityService(store),reports=new AutoUtReports(store,quality,autoUt,undefined,false);
 const archived='66666666-6666-4666-8666-666666666666',report='77777777-7777-4777-8777-777777777777';
 store.putRecord('auto-ut-governance',archived,{id:archived,repository:'Broken',reportVersion:'R27C10',baseBranch:'master',status:'MR_PENDING',message:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),pullRequestUrl:'https://example.com/merge_requests/1',governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'PENDING'}});
 store.putRecord('automation-record-hidden',archived,{id:archived});
 const plan=['Broken','Healthy'].map(repository=>({repository,version:'R27C10',baseBranch:'master',failedTests:1,lineCoverage:.5,lineGoal:.8,branchCoverage:.5,branchGoal:.7,configured:true,repositoryUrl:'ssh://example/demo',repositoryCustomized:false,repairBranch:'fix'}));
 store.putRecord('auto-ut-report-run',report,{id:report,trigger:'MANUAL',status:'READY',createdAt:new Date().toISOString(),config,plan,taskIds:[],messages:[],claimed:[]});
 let checks=0;const started:string[]=[];autoUt.resolveMr=async()=>{checks++;throw Error('CodeHub 返回缺少必要字段');};autoUt.start=async buffer=>{started.push(buffer.toString());return[];};
 try{const result=await reports.start(report,'AUTOMATIC');assert.equal(started.length,1);assert.match(started[0]!,/Healthy/);assert.match(result.messages.join('\n'),/历史 MR 待核验/);
 assert.equal(autoUt.blocksRepository('Broken','R27C10','master'),true);assert.equal(autoUt.blocksRepository('Broken','R27C00','master'),false);
 const summary=autoUt.governanceSummary();assert.equal(summary.records.length,0);assert.equal(summary.blockedRecords.length,1);assert.match(summary.blockedRecords[0]!.mrCheck!.error,/缺少必要字段/);
 const released=autoUt.releaseArchivedMr(archived,'旧 MR 已失效，确认重新治理');assert.equal(released.governance.mrState,'PENDING');assert.equal(released.mrBlockRelease!.source,'USER');assert.ok(released.mrBlockRelease!.at);
 assert.equal(autoUt.blocksRepository('Broken','R27C10','master'),false);assert.equal(autoUt.governanceSummary().blockedRecords.length,0);
 await autoUt.refreshDeletedMrs('Broken','R27C10','master');assert.equal(checks,1);
 await reports.start(report,'AUTOMATIC');assert.equal(started.length,2);assert.match(started[1]!,/Broken/);
 }finally{await reports.close();await quality.close();await autoUt.close();store.close();}
});
test('手动解除不能绕过仍存在的任务或未隐藏的记录',async()=>{
 const store=new TaskStore(':memory:'),autoUt=new AutoUtService(store,undefined,false);const id='88888888-8888-4888-8888-888888888888';
 try{store.putRecord('auto-ut-governance',id,{id,governance:{mrState:'PENDING'}});assert.throws(()=>autoUt.releaseArchivedMr(id,'test'),/只能解除/);store.putRecord('automation-record-hidden',id,{id});store.putRecord('auto-ut-task',id,{id});assert.throws(()=>autoUt.releaseArchivedMr(id,'test'),/只能解除/);}finally{store.deleteRecord('auto-ut-task',id);await autoUt.close();store.close();}
});

test('删除关联质量检查只移除质量记录，保留报告、UT 和目录；重复删除幂等',async()=>{
 const store=new TaskStore(':memory:'),quality=new QualityService(store,undefined,async()=>Response.json({results:{A:{tables:[{columns:[],rows:[]}]}}})),autoUt=new AutoUtService(store,undefined,false),reports=new AutoUtReports(store,quality,autoUt,undefined,false),records=new AutomationRecords(autoUt,reports,quality);
 const qualityId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reportId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',taskId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 try{
  store.putRecord('quality-job',qualityId,{id:qualityId,status:'SUCCEEDED',input:query,parts:[],createdAt:new Date().toISOString()});
  store.putRecord('auto-ut-report-run',reportId,{id:reportId,jobId:qualityId,status:'READY',config,plan:[],taskIds:[taskId],claimed:[],messages:[]});
  store.putRecord('auto-ut-task',taskId,{id:taskId,sourceReportId:reportId,repository:'Demo',workspaceRoot:'/tmp',status:'RESOLVED'});
  for(let i=0;i<2;i++){const result=await records.cleanup({entries:[{kind:'quality',id:qualityId}]});assert.equal(result.failed.length,0);}
  assert.equal(quality.list().length,0);assert.equal(quality.get(qualityId).status,'SUCCEEDED');assert.equal(reports.get(reportId).id,reportId);assert.ok(store.getRecord('auto-ut-task',taskId));
  assert.equal((await records.cleanup({entries:[{kind:'report',id:reportId}]})).failed.length,0);assert.ok(store.getRecord('auto-ut-task',taskId));
 }finally{store.deleteRecord('auto-ut-task',taskId);await reports.close();await quality.close();await autoUt.close();store.close();}
});
