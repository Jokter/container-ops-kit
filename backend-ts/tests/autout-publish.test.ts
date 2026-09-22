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
 const root=await mkdtemp(join(tmpdir(),'ut-publish-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);
 t.after(async()=>{service.close();store.close();await rm(root,{recursive:true,force:true});});
 const git=async(...args:string[])=>{const result=await runProcess(['git',...args],root,10000);assert.equal(result.exitCode,0,result.output);return result.output.trim();};
 await mkdir(join(root,'src/test/java'),{recursive:true});
 await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(value); } }');
 await git('init','-b','main');await git('config','user.name','Test');await git('config','user.email','test@example.com');await git('add','.');await git('commit','-m','base');await git('checkout','-b','repair');
 await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(repaired); } }');
 const evidence:UtEvidence={tests:1,failures:0,errors:0,skipped:0,passedIds:['Demo#ok'],failedIds:[],caseIds:['Demo#ok'],details:''};
 const now=new Date().toISOString(),task:AutoUtTask={id:'publish-test',repository:'Demo',username:'tester',ticket:'DTS123',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:root,executionMode:'AUTOMATIC',status:'WAITING_EXTERNAL',nextStage:'PUBLISH',progress:90,attempts:1,message:'',pullRequestUrl:'',createdAt:now,updatedAt:now,history:[],liveEvents:[],liveSequence:0,governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,baseline:{...evidence,passedIds:[],failedIds:['Demo#ok'],failures:1},verified:evidence,fixedIds:['Demo#ok']}};
 let uploads=0,regressions=0,failUpload=true,failCommit=false;
 const original=service['command'].bind(service);
 service['command']=async(task,args,dir,timeout,label,required=true)=>{
  if(label==='提交修改'&&failCommit)throw Error('commit hook rejected');
  if(label==='创建CodeHub-MR'){uploads++;if(failUpload)throw Error('upload rejected');return {exitCode:0,output:JSON.stringify({id:1,mr_url:'https://codehub.example/mr/1'})};}
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
 assert.equal(await f.git('rev-parse','HEAD'),head);assert.equal(f.task.nextStage,'DONE');assert.deepEqual(f.counts(),{uploads:2,regressions:0});
});

test('legacy task with committed tests revalidates once and resumes upload',async t=>{
 const f=await fixture(t);await f.git('add','.');await f.git('commit','-m','[DTS123][fix]已手动修正');f.allowUpload();
 await f.service['publish'](f.task,f.root);assert.deepEqual(f.counts(),{uploads:1,regressions:1});assert.equal(f.task.nextStage,'DONE');
});

test('commit hook failure can resume the same staged and verified tree',async t=>{
 const f=await fixture(t);f.rejectCommit(true);await assert.rejects(f.service['publish'](f.task,f.root),/commit hook rejected/);
 f.rejectCommit(false);f.allowUpload();await f.service['publish'](f.task,f.root);
 assert.equal(await f.git('log','-1','--format=%s'),'[DTS123][fix]治理 Demo 单元测试');assert.equal(f.task.nextStage,'DONE');
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
