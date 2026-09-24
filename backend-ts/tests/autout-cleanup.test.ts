import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {mkdtemp,mkdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoUtService,autoUtWorkspace,type AutoUtTask} from '../src/modules/autout/autout.js';
import {TaskStore} from '../src/platform/store.js';

function task(id:string,workspaceRoot:string,repository:string,status:AutoUtTask['status'],updatedAt:string):AutoUtTask{
 return{id,reportVersion:'R27C10',repository,username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot,executionMode:'MANUAL',status,nextStage:'DONE',progress:100,attempts:1,message:'',pullRequestUrl:'',createdAt:updatedAt,updatedAt,history:[],liveEvents:[],liveSequence:0};
}

async function fixture(t:TestContext){const root=await mkdtemp(join(tmpdir(),'autout-cleanup-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);t.after(async()=>{service.close();store.close();await rm(root,{recursive:true,force:true});});return{root,store,service};}

test('执行记录清理遇到其他未完成任务共用目录时保留记录和代码',async t=>{
 const{root,store,service}=await fixture(t),first=task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',root,'Shared','RESOLVED','2026-01-01T00:00:00.000Z'),other=task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',root,'Shared','WAITING_CONFIRMATION','2026-01-01T00:00:00.000Z');
 await mkdir(autoUtWorkspace(first),{recursive:true});
 for(const value of[first,other])store.putRecord('auto-ut-task',value.id,value);
 await assert.rejects(service.removeExecutionRecord(first.id),/未完成任务/);
 assert.equal(service.get(first.id).id,first.id);assert.equal(service.get(other.id).id,other.id);assert.ok((await stat(autoUtWorkspace(first))).isDirectory());
 assert.equal(store.getRecord('automation-record-hidden',first.id),undefined);
});

test('手动删除 UT 任务会同时删除 clone 工作目录和任务记录',async t=>{
 const{root,store,service}=await fixture(t),value=task('11111111-1111-4111-8111-111111111111',root,'Demo','RESOLVED','2026-01-01T00:00:00.000Z'),workspace=autoUtWorkspace(value);
 await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'pom.xml'),'<project/>');store.putRecord('auto-ut-task',value.id,value,value.createdAt);
 const result=await service.deleteTask(value.id);
 assert.equal(result.workspace,workspace);await assert.rejects(stat(workspace));assert.throws(()=>service.get(value.id),/不存在/);
});

test('定时清理只删除超过保留期的可清理任务',async t=>{
 const{root,store,service}=await fixture(t),old=task('22222222-2222-4222-8222-222222222222',root,'OldRepo','WAITING_EXTERNAL','2026-01-01T00:00:00.000Z'),recent=task('33333333-3333-4333-8333-333333333333',root,'RecentRepo','RESOLVED','2026-02-25T00:00:00.000Z'),paused=task('44444444-4444-4444-8444-444444444444',root,'PausedRepo','WAITING_CONFIRMATION','2026-01-01T00:00:00.000Z');
 for(const value of[old,recent,paused]){await mkdir(autoUtWorkspace(value),{recursive:true});store.putRecord('auto-ut-task',value.id,value,value.createdAt);}
 const result=await service.cleanup(30,new Date('2026-03-01T00:00:00.000Z'));
 assert.deepEqual(result.deleted,[old.id]);assert.equal(result.failed.length,0);assert.throws(()=>service.get(old.id),/不存在/);assert.equal(service.get(recent.id).workspacePath,autoUtWorkspace(recent));assert.equal(service.get(paused.id).id,paused.id);
});

test('执行中删除先停止子进程，不进入下一阶段，也不重建任务记录',async t=>{
 const{root,store,service}=await fixture(t),value=task('55555555-5555-4555-8555-555555555555',root,'RunningRepo','DISCOVERED',new Date().toISOString()),workspace=autoUtWorkspace(value);
 value.nextStage='PREPARE';value.executionMode='AUTOMATIC';await mkdir(workspace,{recursive:true});store.putRecord('auto-ut-task',value.id,value);
 const helper=join(root,'running.mjs'),pidFile=join(root,'pid');await writeFile(helper,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
 service['prepare']=async task=>{await service['command'](task,[process.execPath,helper],workspace,10000,'测试阻塞命令');};
 let baseline=false;service['baseline']=async()=>{baseline=true;throw Error('不应进入基线');};
 service['schedule'](value,service['repository']('RunningRepo')!);
 const {readFile}=await import('node:fs/promises');let pid=0;for(let i=0;i<200&&!pid;i++){pid=Number(await readFile(pidFile,'utf8').catch(()=>''));if(!pid)await new Promise(r=>setTimeout(r,10));}assert.ok(pid);
 await service.deleteTask(value.id);assert.throws(()=>process.kill(pid,0));assert.equal(baseline,false);await assert.rejects(stat(workspace));assert.throws(()=>service.get(value.id),/不存在/);assert.equal(service['running'].has(value.id),false);
});

test('MR 合入后收尾删除工具 clone 的仓库，保留任务和治理记录，删除仅执行一次',async t=>{
 const{root,store,service}=await fixture(t),value=task('66666666-6666-4666-8666-666666666666',root,'MergedRepo','MR_PENDING',new Date().toISOString()),workspace=autoUtWorkspace(value);
 value.governance={mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'PENDING'};
 await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'source.java'),'test');store.putRecord('auto-ut-task',value.id,value);
 await service['rememberClonedWorkspace'](value);
 service['mrWorkflow'].checkTerminal=async current=>{assert.ok(await stat(workspace));current.status='RESOLVED';current.governance!.mrState='MERGED';service['save'](current);return true;};
 await service['trackOne'](value,true);
 await assert.rejects(stat(workspace));assert.equal(service.get(value.id).status,'RESOLVED');assert.equal(service.get(value.id).workspaceCleanup?.state,'DELETED');assert.ok(service.governanceRecords().some(r=>r.id===value.id));assert.ok(service.events(value.id,0).some(e=>e.content.includes('克隆仓库已清理')));
 await mkdir(workspace);await writeFile(join(workspace,'new-owner'),'keep');await service['cleanupCompletedWorkspace'](service.get(value.id));assert.ok(await stat(join(workspace,'new-owner')));
});

test('未合入、失败、无归属和共享工作目录均不自动删除',async t=>{
 const{root,store,service}=await fixture(t);
 for(const status of ['MR_PENDING','MR_CLOSED','WAITING_EXTERNAL','RETRY_PENDING','NO_CHANGE','RESOLVED'] as const){
  const value=task('keep-'+status,root,status,status,new Date().toISOString()),workspace=autoUtWorkspace(value);value.governance={mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:status==='RESOLVED'?'MERGED':'PENDING'};
  await mkdir(workspace,{recursive:true});store.putRecord('auto-ut-task',value.id,value);if(status!=='RESOLVED')await service['rememberClonedWorkspace'](value);
  await service['cleanupCompletedWorkspace'](value);assert.ok(await stat(workspace));
 }
 const owner=task('shared-owner',root,'SharedCompleted','RESOLVED',new Date().toISOString());owner.governance={mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'MERGED'};
 const waiting={...owner,id:'shared-waiting',status:'RETRY_PENDING' as const};await mkdir(autoUtWorkspace(owner),{recursive:true});store.putRecord('auto-ut-task',owner.id,owner);store.putRecord('auto-ut-task',waiting.id,waiting);await service['rememberClonedWorkspace'](owner);await service['cleanupCompletedWorkspace'](owner);assert.ok(await stat(autoUtWorkspace(owner)));assert.equal(owner.workspaceCleanup?.state,'SKIPPED');
});

test('路径被替换为符号链接时保留外部文件，清理失败不改变完成状态且不重试',async t=>{
 const{root,store,service}=await fixture(t),value=task('symlink-test',root,'SymlinkRepo','RESOLVED',new Date().toISOString()),workspace=autoUtWorkspace(value);value.governance={mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'MERGED'};
 await mkdir(workspace,{recursive:true});store.putRecord('auto-ut-task',value.id,value);await service['rememberClonedWorkspace'](value);
 const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'keep'),'safe');await rm(workspace,{recursive:true});const{symlink}=await import('node:fs/promises');await symlink(outside,workspace,'junction');
 await service['cleanupCompletedWorkspace'](value);assert.equal(value.status,'RESOLVED');assert.equal(value.workspaceCleanup?.state,'FAILED');assert.ok(await stat(join(outside,'keep')));
 await rm(workspace);await mkdir(workspace);await service['cleanupCompletedWorkspace'](value);assert.ok(await stat(workspace));
});
