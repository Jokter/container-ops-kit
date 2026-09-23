import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoUtService,autoUtCommitTitle,type AutoUtTask} from '../src/modules/autout/autout.js';
import {TaskStore} from '../src/platform/store.js';
import {runProcess} from '../src/infrastructure/process.js';
import type {UtEvidence} from '../src/modules/autout/governance.js';

test('DTS and REQ commit subjects match repository policy',()=>{
 assert.equal(autoUtCommitTitle('DTS2024041201588','Demo'),'[DTS2024041201588][fix]治理 Demo 单元测试');
 assert.equal(autoUtCommitTitle('REQ12345','Demo'),'[REQ12345][feat]治理 Demo 单元测试');
 assert.throws(()=>autoUtCommitTitle('OTHER123','Demo'),/单号必须/);
});

async function fixture(t: test.TestContext){
 const parent=await mkdtemp(join(tmpdir(),'ut-publish-')),root=join(parent,'demo'),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);
 t.after(async()=>{service.close();store.close();await rm(parent,{recursive:true,force:true});});
 const git=async(...args:string[])=>{const result=await runProcess(['git',...args],root,10000);assert.equal(result.exitCode,0,result.output);return result.output.trim();};
 await mkdir(join(root,'src/test/java'),{recursive:true});
 await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(value); } }');
 await git('init','-b','main');await git('config','user.name','Test');await git('config','user.email','test@example.com');await git('add','.');await git('commit','-m','base');await git('checkout','-b','repair');
 await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(repaired); } }');
 const evidence:UtEvidence={tests:1,failures:0,errors:0,skipped:0,passedIds:['Demo#ok'],failedIds:[],caseIds:['Demo#ok'],details:''};
 const now=new Date().toISOString(),task:AutoUtTask={id:'publish-test',repository:'Demo',username:'tester',ticket:'DTS123',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:parent,executionMode:'AUTOMATIC',status:'WAITING_EXTERNAL',nextStage:'PUBLISH',progress:90,attempts:1,message:'',pullRequestUrl:'',createdAt:now,updatedAt:now,history:[],liveEvents:[],liveSequence:0,governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,baseline:{...evidence,passedIds:[],failedIds:['Demo#ok'],failures:1},verified:evidence,fixedIds:['Demo#ok']}};
 let uploads=0,regressions=0,failUpload=true,failCommit=false;
 const original=service['command'].bind(service);
 service['command']=async(task,args,dir,timeout,label,required=true)=>{
  if(args[0]==='codehub-cli'&&args[1]==='mr'&&args[2]==='list')return {exitCode:0,output:'[]'};
  if(args[0]==='codehub-cli'&&args[1]==='mr'&&args[2]==='view')return {exitCode:0,output:JSON.stringify({iid:1,state:'opened',title:'UT治理',e2e_issues:[{id:'DTS123',title:'UT治理'}]})};
  if(label==='提交修改'&&failCommit)throw Error('commit hook rejected');
  if(label==='创建CodeHub-MR'){uploads++;if(failUpload)throw Error('upload rejected');return {exitCode:0,output:JSON.stringify({id:1,mr_url:'https://codehub.example/demo/merge_requests/1'})};}
  return original(task,args,dir,timeout,label,required);
 };
 service['testEvidence']=async()=>{regressions++;return {evidence,exitCode:0};};
 return {root,task,service,git,counts:()=>({uploads,regressions}),allowUpload:()=>{failUpload=false;},rejectCommit:(value:boolean)=>{failCommit=value;}};
}

test('upload failure resumes existing amended commit without another Pi repair or commit',async t=>{
 const f=await fixture(t);await assert.rejects(f.service['publish'](f.task,f.root),/upload rejected/);
 assert.ok(f.task.publication);assert.equal(await f.git('status','--porcelain'),'');
 await f.git('commit','--amend','-m','[DTS123][fix]人工修正描述');const head=await f.git('rev-parse','HEAD');
 f.allowUpload();await f.service['publish'](f.task,f.root);
 assert.equal(await f.git('rev-parse','HEAD'),head);assert.equal(f.task.nextStage,'TRACK');assert.deepEqual(f.counts(),{uploads:2,regressions:0});
});

test('legacy task with committed tests revalidates once and resumes upload',async t=>{
 const f=await fixture(t);await f.git('add','.');await f.git('commit','-m','[DTS123][fix]已手动修正');f.allowUpload();
 await f.service['publish'](f.task,f.root);assert.deepEqual(f.counts(),{uploads:1,regressions:1});assert.equal(f.task.nextStage,'TRACK');
});

test('commit hook failure can resume the same staged and verified tree',async t=>{
 const f=await fixture(t);f.rejectCommit(true);await assert.rejects(f.service['publish'](f.task,f.root),/commit hook rejected/);
 f.rejectCommit(false);f.allowUpload();await f.service['publish'](f.task,f.root);
 assert.equal(await f.git('log','-1','--format=%s'),'[DTS123][fix]治理 Demo 单元测试');assert.equal(f.task.nextStage,'TRACK');
});

test('recovery rejects another branch and production changes without uploading',async t=>{
 const f=await fixture(t);await f.git('add','.');await f.git('commit','-m','[DTS123][fix]tests');
 await f.git('checkout','main');await assert.rejects(f.service['publish'](f.task,f.root),/当前分支/);await f.git('checkout','repair');
 await writeFile(join(f.root,'production.java'),'class Production {}');await f.git('add','.');await f.git('commit','-m','[DTS123][fix]production');
 await assert.rejects(f.service['publish'](f.task,f.root),/非测试文件/);assert.equal(f.counts().uploads,0);
});

test('recovery rejects incorrect existing commit subjects before upload',async t=>{
 const f=await fixture(t);await f.git('add','.');await f.git('commit','-m','wrong subject');
 await assert.rejects(f.service['publish'](f.task,f.root),/已有提交描述不符合规范/);assert.equal(f.counts().uploads,0);
});

test('changed committed tree is revalidated and a failed regression prevents upload',async t=>{
 const f=await fixture(t);await assert.rejects(f.service['publish'](f.task,f.root),/upload rejected/);
 await writeFile(join(f.root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(changed); } }');
 await f.git('add','.');await f.git('commit','--amend','-m','[DTS123][fix]changed tests');
 const evidence=f.task.governance!.verified!;
 f.service['testEvidence']=async()=>({evidence:{...evidence,failures:1,passedIds:[],failedIds:['Demo#ok']},exitCode:1});
 f.allowUpload();await assert.rejects(f.service['publish'](f.task,f.root),/回归未通过/);
 assert.equal(f.counts().uploads,1);
});

test('restart preserves pending MR tracking and pauses an interrupted write',async t=>{
 const f=await fixture(t);f.allowUpload();await f.service['publish'](f.task,f.root);
 const store=new TaskStore(':memory:');t.after(()=>store.close());
 store.putRecord('auto-ut-task',f.task.id,{...f.task,mr:{...f.task.mr!,writePending:'pipeline-repair'},status:'MR_REPAIRING'});
 const restored=new AutoUtService(store,undefined,false);t.after(()=>restored.close());
 assert.equal(restored.get(f.task.id).status,'WAITING_EXTERNAL');assert.equal(restored.get(f.task.id).mr!.paused,true);assert.equal(restored.get(f.task.id).mr!.writePending,'pipeline-repair');
});

test('pipeline repair validates changes and appends a normal push without rewriting history',async t=>{
 const f=await fixture(t);f.allowUpload();await f.service['publish'](f.task,f.root);const head=await f.git('rev-parse','HEAD');
 await mkdir(join(f.root,'.codecovcli/report'),{recursive:true});await writeFile(join(f.root,'.codecovcli/report/result.json'),'{}');
 const command=f.service['command'].bind(f.service);const pushes:string[][]=[];
 f.service['command']=async(task,args,dir,timeout,label,required=true)=>{if(args[0]==='git'&&args[1]==='ls-remote')return {exitCode:0,output:head+'\trefs/heads/repair\n'};if(args[0]==='git'&&args[1]==='push'){pushes.push(args);return{exitCode:0,output:''};}return command(task,args,dir,timeout,label,required);};
 f.service['runPi']=async()=>{await writeFile(join(f.root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(pipelineFixed); } }');return {exitCode:0,output:''};};
 const next=await f.service['repairPipeline'](f.task,'src/test/java/DemoTest.java AssertionError',head);
 assert.notEqual(next,head);assert.equal(await f.git('rev-parse','HEAD^'),head);assert.deepEqual(pushes,[['git','push','origin','HEAD:refs/heads/repair']]);assert.equal(f.task.mr!.repairCommitSha,next);
});

test('pipeline repair refuses production changes from Pi before commit or push',async t=>{
 const f=await fixture(t);f.allowUpload();await f.service['publish'](f.task,f.root);const head=await f.git('rev-parse','HEAD'),command=f.service['command'].bind(f.service);
 f.service['command']=async(task,args,dir,timeout,label,required=true)=>args[1]==='ls-remote'?{exitCode:0,output:head+'\trefs/heads/repair\n'}:command(task,args,dir,timeout,label,required);
 f.service['runPi']=async()=>{await writeFile(join(f.root,'production.java'),'class Changed {}');return {exitCode:0,output:''};};
 await assert.rejects(f.service['repairPipeline'](f.task,'test failure',head),/测试目录之外/);assert.equal(await f.git('rev-parse','HEAD'),head);
});

test('first publish recovers a successful upload with incomplete output in the same execution',async t=>{
 const f=await fixture(t);f.allowUpload();const command=f.service['command'].bind(f.service);let lists=0;
 f.service['command']=async(task,args,dir,timeout,label,required=true)=>{
  if(args[0]==='codehub-cli'&&args[1]==='mr'&&args[2]==='list'){lists++;return{exitCode:0,output:JSON.stringify([{iid:1,state:'opened',source_branch:'repair',target_branch:'main',web_url:'https://codehub.example/demo/merge_requests/1'}])};}
  const result=await command(task,args,dir,timeout,label,required);
  return label==='创建CodeHub-MR'?{...result,output:'{"id":1}'}:result;
 };
 await f.service['publish'](f.task,f.root);
 assert.equal(f.counts().uploads,1);assert.equal(lists,1);assert.equal(f.task.mr!.iid,'1');assert.equal(f.task.mr!.phase,'PIPELINE');assert.equal(f.task.nextStage,'TRACK');
});
