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
