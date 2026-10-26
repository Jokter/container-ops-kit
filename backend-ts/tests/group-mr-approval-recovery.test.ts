import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {GroupMrService,groupMrRoutes,type Entry} from '../src/modules/automation/group-mr.js';
import {TaskStore} from '../src/platform/store.js';

const sha='a'.repeat(40),otherSha='b'.repeat(40),repo='MAE-M/Access/ReviewRecovery';
const cfg={enabled:false,groupId:'123456789',authorizedSender:'owner',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10};
type Action='检视'|'审核';
function acknowledgement(e:Entry){return {confirmed:true,sha:e.sha,action:e.writePending,operationId:e.approvalPending?.operationId??''};}
function entry(action:Action='检视'):Entry{
 const id=randomUUID(),time='2026-10-26T08:01:22.000Z';
 return {id,repo,iid:'1',url:'https://codehub-y.huawei.com/'+repo+'/merge_requests/1',sha,previousSha:'',messageId:'1',sender:'developer',shortcut:false,humanReviewRequired:true,rolesPrepared:true,
  humanReview:{id:randomUUID(),entryId:id,repo,iid:'1',url:'',sha,time,decision:'pass',reason:'已人工检查原提交',category:'',waitMs:0,actor:'平台人工审核',knowledgeStatus:'skipped'},
  phase:action==='检视'?'REVIEW':'APPROVE',stage:action==='检视'?'REVIEW':'APPROVE',status:'操作结果未确认',detail:'上次读取结果未确认',createdAt:time,updatedAt:time,writePending:action,events:[],
  approvalPending:{operationId:randomUUID(),action,sha,username:'original-user'}};
}
interface Options {
 head?:string;changeDuringRead?:boolean;state?:string;ownState?:string;otherState?:string;gatePassed?:boolean;mergePassed?:boolean;
 failure?:'view'|'gate'|'pipeline'|'review';legacy?:boolean;pipelinePassed?:boolean;unresolved?:boolean;
 holdView?:()=>Promise<void>;
}
function fixture(action:Action='检视',options:Options={}){
 const store=new TaskStore(':memory:'),e=entry(action),calls:string[][]=[],writes:string[][]=[];
 if(options.legacy)delete e.approvalPending;
 store.putRecord('group-mr-entry',e.id,e);
 let views=0;
 const service=new GroupMrService(store,async args=>{
  calls.push([...args]);
  if(args[0]!=='codehub-cli'||(!['view','gate','pipeline','changes'].includes(args[2]??'')&&!(args[2]==='review'&&(args[3]==='list'||args.includes('--help'))))){
   writes.push([...args]);throw Error('Recovery must only read remote state');
  }
  if(args.includes('--help'))return {exitCode:0,output:'unsupported'};
  if(args[2]===options.failure)throw Error('simulated read failure');
  let value:unknown={};
  if(args[2]==='view'){
   if(options.holdView)await options.holdView();
   const head=options.changeDuringRead&&++views>1?otherSha:options.head??sha;
   const people=[{username:'ORIGINAL-USER',state:options.ownState??(action==='检视'?'true':'approve')},{username:'another-user',state:options.otherState??'optional'}];
   value={iid:1,state:options.state??'opened',sha:head,approval_merge_request_reviewers:action==='检视'?people:[],approval_merge_request_approvers:action==='审核'?people:[]};
  }else if(args[2]==='gate')value={ci_state_passed:true,quality_gate:{passed:true},conflict_passed:true,approval_reviewers_required_passed:action==='检视'&&options.gatePassed===true,approval_approvers_required_passed:action==='审核'&&options.gatePassed===true,merge_gate_passed:options.mergePassed===true};
  else if(args[2]==='pipeline')value=[{id:1,sha:options.head??sha,status:options.pipelinePassed===false?'running':'success'}];
  else if(args[2]==='review')value=options.unresolved?[{id:'unresolved',resolved:false,notes:[{id:1,body:'仍需修复',resolvable:true,author:{username:'developer'}}]}]:[];
  else if(args[2]==='changes')value={changes:[]};
  return {exitCode:0,output:JSON.stringify(value)};
 });
 const saved=()=>store.getRecord<Entry>('group-mr-entry',e.id)!;
 return {store,service,e,calls,writes,saved,close:async()=>{await service.close();store.close();}};
}

for(const action of ['检视','审核'] as const)for(const route of ['readiness','workspace','background'] as const)test(action+' pending recovers via '+route+' from the original account without replay',async()=>{
 const f=fixture(action);
 try{
  assert.equal(f.saved().phase,'INTERRUPTED');
  if(route==='readiness')await f.service['refreshReadiness'](f.saved());
  else if(route==='workspace')assert.equal((await f.service.reviewWorkspace(f.e.id)).writePending,'');
  else {f.service.refreshRemoteStates();await Promise.allSettled(f.service['background']);}
  const saved=f.saved();
  assert.equal(saved.writePending,'');assert.equal(saved.approvalPending,undefined);assert.equal(saved.phase,'ISSUES');
  assert.equal(saved.sha,sha);assert.deepEqual(saved.humanReview,f.e.humanReview);assert.equal(saved.readiness?.ready,true);
  assert.match(saved.status,/操作账号已完成/);assert.deepEqual(f.writes,[]);
  assert.ok(f.calls.every(args=>args[1]!=='user'),'Recovery must use the persisted executing identity, not a newly logged-in account');
 }finally{await f.close();}
});

for(const action of ['检视','审核'] as const)test('legacy '+action+' pending recovers only from its specific gate',async()=>{
 const f=fixture(action,{legacy:true,ownState:'optional',gatePassed:true});
 try{
  await f.service['refreshReadiness'](f.saved());assert.equal(f.saved().writePending,'');assert.match(f.saved().status,/门禁已通过/);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

for(const mode of ['optional','other-person','passed-by-others','wrong-role-state','changed-head','changing-head','legacy-unknown','overall-gate-only','wrong-operation-sha','wrong-operation-action','view-failure','gate-failure','pipeline-failure','notes-failure'] as const)test('approval recovery remains blocked: '+mode,async()=>{
 const options:Options={};
 if(mode==='optional'||mode==='overall-gate-only')options.ownState='optional';
 if(mode==='other-person'){options.ownState='optional';options.otherState='true';}
 if(mode==='passed-by-others')options.ownState='passed';
 if(mode==='wrong-role-state')options.ownState='approve';
 if(mode==='changed-head')options.head=otherSha;
 if(mode==='changing-head')options.changeDuringRead=true;
 if(mode==='legacy-unknown')options.legacy=true;
 if(mode==='overall-gate-only')options.mergePassed=true;
 if(mode==='view-failure')options.failure='view';
 if(mode==='gate-failure')options.failure='gate';
 if(mode==='pipeline-failure')options.failure='pipeline';
 if(mode==='notes-failure')options.failure='review';
 const f=fixture('检视',options);
 if(mode==='wrong-operation-sha'){const e=f.saved();e.approvalPending!.sha=otherSha;f.store.putRecord('group-mr-entry',e.id,e);}
 if(mode==='wrong-operation-action'){const e=f.saved();e.approvalPending!.action='审核';f.store.putRecord('group-mr-entry',e.id,e);}
 try{
  await f.service['refreshReadiness'](f.saved());
  assert.equal(f.saved().writePending,'检视');assert.equal(f.saved().sha,sha);assert.deepEqual(f.saved().humanReview,f.e.humanReview);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

for(const mode of ['unresolved','running-pipeline'] as const)test('confirming completed review does not bypass '+mode,async()=>{
 const f=fixture('检视',{unresolved:mode==='unresolved',pipelinePassed:mode==='running-pipeline'?false:true});
 try{
  await f.service['refreshReadiness'](f.saved());
  assert.equal(f.saved().writePending,'');assert.equal(f.saved().readiness?.ready,false);assert.equal(f.saved().phase,'ISSUES');assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('resending an uncertain review carries the original operation identity into the current row',async()=>{
 const f=fixture('检视',{ownState:'optional'});
 try{
  await f.service['accept']({id:'second-message',sender:'developer',quoteId:'',content:f.e.url},cfg);
  const successor=f.service.list().find(r=>r.id!==f.e.id)!;
  assert.ok(successor);assert.deepEqual(successor.approvalPending,f.e.approvalPending);assert.equal(successor.sha,sha);assert.equal(successor.writePending,'检视');
  assert.equal(f.saved().supersededBy,successor.id);assert.equal(f.calls.length,0);
  await f.service.acknowledgeApproval(successor.id,acknowledgement(successor));
  for(const id of [f.e.id,successor.id])assert.equal(f.store.getRecord<Entry>('group-mr-entry',id)!.writePending,'');
  assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

for(const action of ['检视','审核'] as const)test('manual '+action+' acknowledgement releases a stale task without approving the new commit',async()=>{
 const f=fixture(action,{head:otherSha,ownState:'optional'});
 try{
  await f.service.acknowledgeApproval(f.e.id,acknowledgement(f.e));
  const saved=f.saved();assert.equal(saved.writePending,'');assert.equal(saved.approvalPending,undefined);assert.equal(saved.sha,sha);
  assert.deepEqual(saved.humanReview,f.e.humanReview);assert.equal(saved.piReview,undefined);assert.equal(saved.readiness,undefined);assert.match(saved.status,/提交已变化/);
  await assert.rejects(f.service.continueReview(f.e.id,{sha}),/提交已变化/);
  const workspace=await f.service.reviewWorkspace(f.e.id);assert.equal(workspace.stale,true);assert.equal(workspace.sha,otherSha);assert.equal(workspace.writePending,'');
  assert.equal(f.store.records('automation-intervention').length,1);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('manual acknowledgement clears only the matching operation chain',async()=>{
 const f=fixture('检视',{ownState:'optional'}),e=f.saved();
 const related:Entry={...e,id:randomUUID(),supersededBy:e.id};
 const differentSha:Entry={...e,id:randomUUID(),sha:otherSha,supersededBy:e.id};
 const differentAction:Entry={...e,id:randomUUID(),writePending:'审核',supersededBy:e.id};
 const differentOperation:Entry={...e,id:randomUUID(),approvalPending:{...e.approvalPending!,operationId:randomUUID()},supersededBy:e.id};
 const differentMr:Entry={...e,id:randomUUID(),iid:'2'};
 for(const row of [related,differentSha,differentAction,differentOperation,differentMr])f.store.putRecord('group-mr-entry',row.id,row);
 try{
  await f.service.acknowledgeApproval(e.id,acknowledgement(e));
  assert.equal(f.saved().writePending,'');assert.equal(f.store.getRecord<Entry>('group-mr-entry',related.id)!.writePending,'');
  for(const row of [differentSha,differentAction,differentOperation,differentMr])assert.equal(f.store.getRecord<Entry>('group-mr-entry',row.id)!.writePending,row.writePending);
  assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

for(const mode of ['manual','automatic'] as const)test('legacy '+mode+' recovery clears only the ancestor chain, not unrelated old attempts',async()=>{
 const f=fixture('检视',{legacy:true,ownState:'optional',gatePassed:mode==='automatic'}),e=f.saved();
 const previous:Entry={...e,id:randomUUID(),supersededBy:e.id};
 const ancestor:Entry={...e,id:randomUUID(),supersededBy:previous.id};
 const unrelated:Entry={...e,id:randomUUID(),supersededBy:randomUUID()};
 const cyclic:Entry={...e,id:randomUUID()};cyclic.supersededBy=cyclic.id;
 for(const row of [previous,ancestor,unrelated,cyclic])f.store.putRecord('group-mr-entry',row.id,row);
 try{
  if(mode==='manual')await f.service.acknowledgeApproval(e.id,acknowledgement(e));
  else await f.service['refreshReadiness'](f.saved());
  for(const row of [e,previous,ancestor])assert.equal(f.store.getRecord<Entry>('group-mr-entry',row.id)!.writePending,'');
  for(const row of [unrelated,cyclic])assert.equal(f.store.getRecord<Entry>('group-mr-entry',row.id)!.writePending,'检视');
  assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('an old confirmation cannot clear a newer operation on the same commit and action',async()=>{
 const f=fixture(),staleInput=acknowledgement(f.saved()),latest=f.saved();
 latest.approvalPending={...latest.approvalPending!,operationId:randomUUID()};
 f.store.putRecord('group-mr-entry',latest.id,latest);
 try{
  await assert.rejects(f.service.acknowledgeApproval(latest.id,staleInput),/待核对操作已变化/);
  assert.equal(f.saved().writePending,'检视');assert.equal(f.saved().approvalPending?.operationId,latest.approvalPending.operationId);
  assert.equal(f.calls.length,0);assert.equal(f.store.records('automation-intervention').length,0);
 }finally{await f.close();}
});

for(const mode of ['wrong-sha','wrong-action','hidden','superseded','not-confirmed','unsupported-action'] as const)test('manual result acknowledgement rejects '+mode+' before remote work',async()=>{
 const f=fixture();
 if(mode==='hidden')f.store.putRecord('group-mr-hidden',f.e.id,{id:f.e.id});
 if(mode==='superseded'){const e=f.saved();e.supersededBy=randomUUID();f.store.putRecord('group-mr-entry',e.id,e);}
 const input={operationId:f.e.approvalPending!.operationId,confirmed:mode!=='not-confirmed',sha:mode==='wrong-sha'?otherSha:sha,action:mode==='wrong-action'?'审核':mode==='unsupported-action'?'合并':'检视'};
 try{
  await assert.rejects(f.service.acknowledgeApproval(f.e.id,input));assert.equal(f.saved().writePending,'检视');assert.equal(f.calls.length,0);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('failed remote read keeps the manual blocker and creates no acknowledgement audit',async()=>{
 const f=fixture('审核',{failure:'view'});
 try{
  await assert.rejects(f.service.acknowledgeApproval(f.e.id,acknowledgement(f.e)));
  assert.equal(f.saved().writePending,'审核');assert.ok(f.saved().approvalPending);assert.equal(f.store.records('automation-intervention').length,0);assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
});

test('acknowledgement endpoint rejects missing confirmation and duplicate in-flight actions',async()=>{
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);
 const f=fixture('检视',{holdView:()=>held}),app=Fastify();groupMrRoutes(app,f.service);
 const url='/api/automation/group-mr/records/'+f.e.id+'/acknowledge-approval';
 try{
  const invalid=await app.inject({method:'POST',url,payload:{sha,action:'检视',operationId:f.e.approvalPending!.operationId}});assert.ok(invalid.statusCode>=400);assert.equal(f.calls.length,0);
  const missingOperation=await app.inject({method:'POST',url,payload:{confirmed:true,sha,action:'检视'}});assert.ok(missingOperation.statusCode>=400);assert.equal(f.calls.length,0);
  const first=f.service.acknowledgeApproval(f.e.id,acknowledgement(f.e));
  await assert.rejects(f.service.acknowledgeApproval(f.e.id,acknowledgement(f.e)),/执行或排队|排队或执行/);
  release();await first;
  const duplicate=await app.inject({method:'POST',url,payload:acknowledgement(f.e)});assert.equal(duplicate.statusCode,409);
  assert.equal(f.store.records('automation-intervention').length,1);assert.deepEqual(f.writes,[]);
 }finally{release();await f.close();await app.close();}
});

for(const action of ['检视','审核'] as const)for(const timeout of [false,true])test('real workflow recognises '+action+' result and never replays after '+(timeout?'timeout recovery':'success'),async()=>{
 const e=entry(action);e.writePending='';delete e.approvalPending;e.phase='ISSUES';
 const store=new TaskStore(':memory:'),writes:string[][]=[];let ownState='optional';
 store.putRecord('group-mr-entry',e.id,e);
 const service=new GroupMrService(store,async args=>{
  let value:unknown={};
  if(args[0]!=='codehub-cli')throw Error('Unexpected external command');
  if(args[1]==='user')value={username:'original-user'};
  else if(args[2]==='view')value={iid:1,state:'opened',sha,approval_merge_request_reviewers:[{username:'original-user',state:action==='检视'?ownState:'true'}],approval_merge_request_approvers:[{username:'original-user',state:action==='审核'?ownState:'optional'}]};
  else if(args[2]==='gate')value={ci_state_passed:true,quality_gate:{passed:true},conflict_passed:true,approval_reviewers_required_passed:action==='审核',approval_approvers_required_passed:false,merge_gate_passed:false};
  else if(args[2]==='pipeline')value=[{id:1,sha,status:'success'}];
  else if(args[2]==='review'&&args[3]==='list')value=[];
  else if(args[2]===(action==='检视'?'approve-review':'approve')){
   writes.push([...args]);ownState=action==='检视'?'true':'approve';
   const persisted=store.getRecord<Entry>('group-mr-entry',e.id)!;
   assert.equal(persisted.writePending,action);assert.equal(persisted.approvalPending?.username,'original-user');assert.equal(persisted.approvalPending?.sha,sha);assert.equal(persisted.approvalPending?.action,action);
   if(timeout)return {exitCode:124,output:'timeout'};
   value={state:ownState};
  }else throw Error('Unexpected mutation or command: '+args.slice(0,4).join(' '));
  return {exitCode:0,output:JSON.stringify(value)};
 });
 // Group notification is outside this regression; only CodeHub writes are under test.
 service['reply']=async()=>{};
 try{
  if(timeout){
   await assert.rejects(service['processEntry'](e,cfg),/退出码 124/);
   const pending=store.getRecord<Entry>('group-mr-entry',e.id)!;assert.equal(pending.writePending,action);assert.ok(pending.approvalPending?.operationId);
   await service['refreshReadiness'](pending);
   assert.equal(store.getRecord<Entry>('group-mr-entry',e.id)!.writePending,'');assert.equal(writes.length,1);
  }else{
   await service['processEntry'](e,cfg);
   const saved=store.getRecord<Entry>('group-mr-entry',e.id)!;assert.equal(saved.writePending,'');assert.equal(saved.approvalPending,undefined);assert.match(saved.status,/已完成，等待其他人员满足门禁/);assert.equal(saved.phase,'ISSUES');
  }
  assert.equal(writes.length,1);
 }finally{await service.close();store.close();}
});
