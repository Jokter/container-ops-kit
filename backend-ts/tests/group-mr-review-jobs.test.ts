import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {GroupMrService,groupMrRoutes,type Entry} from '../src/modules/automation/group-mr.js';
import {TaskStore} from '../src/platform/store.js';

const sha='a'.repeat(40),input={sha,decision:'pass',reason:''};
function deferred(){let release:()=>void=()=>{};const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};}
async function settle(service:GroupMrService){await Promise.allSettled(service['background']);}
function entry(iid='1'):Entry{return {id:randomUUID(),repo:'MAE-M/Access/Demo',iid,url:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/'+iid,sha,previousSha:'',messageId:'1',sender:'developer',shortcut:false,humanReviewRequired:true,phase:'HUMAN',status:'等待审核',detail:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),writePending:'',pipelinePassed:true,events:[],readiness:{sha,checkedAt:new Date().toISOString(),ready:true,reason:''}};}
function fixture(){
 const store=new TaskStore(':memory:'),calls:string[][]=[];let reviewed=false,approved=false,merged=false;
 const state={remoteState:'opened',head:sha,notes:false,pipeline:true,mergeGate:true,hold:undefined as Promise<void>|undefined,changeAfter:'',mutateAt:'',mutation:'',knowledgeContext:undefined as object|undefined,knowledgeHold:undefined as Promise<void>|undefined};
 const service:GroupMrService=new GroupMrService(store,async args=>{
  calls.push([...args]);if(state.hold)await state.hold;
  if(args[2]==='changes')state.knowledgeContext=service['context'];
  const knowledge=state.knowledgeContext===service['context'];if(args[2]==='view'&&knowledge&&state.knowledgeHold)await state.knowledgeHold;
  let result:unknown={};
  if(args[0]==='welink-cli')result={resultCode:0};
  else if(args[1]==='user')result={username:'owner'};
  else if(args[2]==='view')result={title:knowledge?'late knowledge title':undefined,iid:1,state:merged?'merged':state.remoteState,sha:state.head,approval_merge_request_reviewers:[{username:'owner',state:reviewed?'true':'false'}],approval_merge_request_approvers:[{username:'owner',state:approved?'true':'false'}],merge_request_assignee_list:[{username:'owner'}]};
  else if(args[2]==='gate')result={ci_state_passed:state.pipeline,quality_gate:{passed:true},conflict_passed:true,approval_reviewers_required_passed:reviewed,approval_approvers_required_passed:approved,merge_gate_passed:state.mergeGate&&reviewed&&approved};
  else if(args[2]==='pipeline')result=[{id:1,sha:state.head,status:state.pipeline?'success':'failed'}];
  else if(args[2]==='changes')result=[];
  else if(args[2]==='review')result=state.notes?[{id:'late',resolved:false,notes:[{body:'new issue',resolvable:true}]}]:[];
  else if(args[2]==='approve-review')reviewed=true;
  else if(args[2]==='approve')approved=true;
  else if(args[2]==='merge')merged=true;
  else throw Error('Unexpected mock CLI: '+args.slice(0,3).join(' '));
  if(state.mutateAt===(args[1]==='user'?'user-view':args[2])){if(state.mutation==='notes')state.notes=true;if(state.mutation==='pipeline')state.pipeline=false;state.mutateAt='';}
  if(state.changeAfter===args[2]){state.head='b'.repeat(40);state.changeAfter='';}
  return {exitCode:0,output:JSON.stringify(result)};
 },undefined,undefined,{send:async()=>{}});
 store.putRecord('group-mr-config','main',{enabled:false,groupId:'',authorizedSender:'owner',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10});
 const e=entry();store.putRecord('group-mr-entry',e.id,e);
 return {store,service,e,calls,state,saved:()=>store.getRecord<Entry>('group-mr-entry',e.id)!,close:async()=>{state.hold=undefined;await service.close();store.close();}};
}

test('review jobs return 202 before remote reads finish and identical submissions share one durable job',async()=>{
 const f=fixture(),held=deferred(),app=Fastify();groupMrRoutes(app,f.service);f.state.hold=held.promise;
 try{
  const response=await app.inject({method:'POST',url:'/api/automation/group-mr/records/'+f.e.id+'/review-jobs',payload:input});
  assert.equal(response.statusCode,202);const accepted=response.json<Entry>();assert.equal(accepted.reviewJob?.status,'checking');assert.equal(accepted.humanReview,undefined);assert.equal(f.saved().humanReview,undefined);
  const duplicate=f.service.submitReviewJob(f.e.id,input);assert.equal(duplicate.reviewJob?.id,accepted.reviewJob?.id);assert.equal(f.calls.length,1);
  assert.throws(()=>f.service.submitReviewJob(f.e.id,{...input,reason:'changed request'}),/已有审核任务/);
  assert.throws(()=>f.service.submitReviewJob(f.e.id,{...input,sha:'b'.repeat(40)}),/提交已变化/);
  held.release();await settle(f.service);assert.equal(f.saved().reviewJob?.status,'completed');assert.equal(f.saved().phase,'DONE');
  const count=f.calls.length;assert.equal(f.service.submitReviewJob(f.e.id,input).reviewJob?.id,accepted.reviewJob?.id);assert.equal(f.calls.length,count);
 }finally{held.release();await app.close();await f.close();}
});

test('status reads are local and do not start CodeHub inspection',async()=>{
 const f=fixture(),app=Fastify();groupMrRoutes(app,f.service);
 try{const response=await app.inject({method:'GET',url:'/api/automation/group-mr/status'});assert.equal(response.statusCode,200);assert.equal(response.json<{pending:unknown[]}>().pending.length,1);assert.equal(f.calls.length,0);}
 finally{await app.close();await f.close();}
});

for(const prepared of [true,false])test('approval completes with fewer live reads and exactly one of each write, prepared='+prepared,async()=>{
 const f=fixture();f.e.rolesPrepared=prepared;f.store.putRecord('group-mr-entry',f.e.id,f.e);
 try{f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.saved().phase,'DONE');assert.equal(f.calls.length,prepared?36:37);for(const action of ['approve-review','approve','merge'])assert.equal(f.calls.filter(args=>args[2]===action).length,1);assert.ok(f.calls.every(args=>args.includes('--no-cache')));}
 finally{await f.close();}
});

for(const failure of ['notes','pipeline','sha','mergeGate','sha-after-review','sha-after-approve'])test('accepted review jobs cannot bypass remote safety checks: '+failure,async()=>{
 const f=fixture();
 if(failure==='notes')f.state.notes=true;
 if(failure==='pipeline')f.state.pipeline=false;
 if(failure==='sha')f.state.head='b'.repeat(40);
 if(failure==='mergeGate')f.state.mergeGate=false;
 if(failure==='sha-after-review')f.state.changeAfter='approve-review';
 if(failure==='sha-after-approve')f.state.changeAfter='approve';
 try{f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.calls.some(args=>args[2]==='merge'),false);assert.notEqual(f.saved().phase,'DONE');assert.ok(['completed','failed'].includes(f.saved().reviewJob?.status??''));if(['notes','pipeline','sha'].includes(failure))assert.equal(f.saved().humanReview,undefined);}
 finally{await f.close();}
});

test('an accepted job waits for its MR background read and retains acceptance across stale saves',async()=>{
 const f=fixture(),held=deferred();f.state.hold=held.promise;
 // A manual pipeline entry could otherwise be automatically continued by the background task.
 f.e.source='manual';f.e.notificationReceiver='';f.e.phase='PIPELINE';f.e.pipelineWaiting=true;f.store.putRecord('group-mr-entry',f.e.id,f.e);
 const continuation=f.service['executeEntry'].bind(f.service);let continuations=0;
 f.service['executeEntry']=async(...args)=>{continuations++;return continuation(...args);};
 try{
  f.service.refreshRemoteStates();assert.equal(f.calls.length,1);
  const accepted=f.service.submitReviewJob(f.e.id,input);assert.equal(accepted.reviewJob?.status,'queued');assert.equal(f.saved().humanReview,undefined);
  // Simulate the in-flight reader persisting its pre-acceptance object.
  f.service['save']({...f.e,title:'fresh remote title'});assert.equal(f.saved().reviewJob?.id,accepted.reviewJob?.id);assert.equal(f.saved().queued,true);
  assert.equal(f.service.submitReviewJob(f.e.id,input).reviewJob?.id,accepted.reviewJob?.id);
  held.release();await settle(f.service);assert.equal(continuations,0);assert.equal(f.saved().phase,'DONE');assert.equal(f.saved().reviewJob?.status,'completed');assert.equal(f.service['reserved'].size,0);
 }finally{held.release();await f.close();}
});

test('background reads leave one slot available and manual work is scheduled before queued ordinary work',async()=>{
 const f=fixture(),held=deferred(),jobs:Promise<void>[]=[],order:string[]=[];
 try{
  for(let i=2;i<=6;i++){const e=entry(String(i));f.store.putRecord('group-mr-entry',e.id,e);}
  f.state.hold=held.promise;f.service.refreshRemoteStates();assert.equal(f.service['active'].size,4);
  const fifth=entry('50');jobs.push(f.service['enqueue'](fifth,()=>held.promise));assert.equal(f.service['active'].size,5);
  const normal=entry('60'),manual=entry('70');jobs.push(f.service['enqueue'](normal,async()=>{order.push('normal');}));jobs.push(f.service['enqueue'](manual,async()=>{order.push('manual');},true,'manual'));
  held.release();await Promise.allSettled(jobs);await settle(f.service);assert.deepEqual(order,['manual','normal']);assert.equal(f.service['active'].size,0);
 }finally{held.release();await f.close();}
});

for(const status of ['queued','checking','running'] as const)test('restart fails unfinished review jobs without replaying writes: '+status,async()=>{
 const store=new TaskStore(':memory:'),e=entry();e.reviewJob={id:randomUUID(),sha,requestHash:'old',status};e.queued=status==='queued';store.putRecord('group-mr-entry',e.id,e);let calls=0;
 const service=new GroupMrService(store,async()=>{calls++;throw Error('must not run');});
 try{const saved=store.getRecord<Entry>('group-mr-entry',e.id)!;assert.equal(saved.reviewJob?.status,'failed');assert.equal(saved.phase,'INTERRUPTED');assert.equal(saved.queued,false);assert.equal(saved.humanReview,undefined);assert.equal(calls,0);}
 finally{await service.close();store.close();}
});

for(const mutation of ['notes','pipeline'])test('changes during identity lookup block the first approval write: '+mutation,async()=>{
 const f=fixture();f.state.mutateAt='user-view';f.state.mutation=mutation;
 try{f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.calls.some(args=>['approve-review','approve','merge'].includes(args[2]??'')),false);assert.equal(f.saved().reviewJob?.status,'failed');}
 finally{await f.close();}
});
for(const action of ['approve-review','approve'])test('new discussion after '+action+' prevents any following approval or merge',async()=>{
 const f=fixture();f.state.mutateAt=action;f.state.mutation='notes';
 try{f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.calls.some(args=>args[2]==='merge'),false);if(action==='approve-review')assert.equal(f.calls.some(args=>args[2]==='approve'),false);assert.equal(f.saved().reviewJob?.status,'failed');}
 finally{await f.close();}
});
test('a completed pass job does not swallow a new pass after a later human rejection',async()=>{
 const f=fixture();f.state.mergeGate=false;
 try{
  const first=f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.saved().reviewJob?.status,'completed');assert.equal(f.saved().phase,'ISSUES');
  // Use the legacy API to simulate a subsequent manual change of conclusion.
  f.service['startKnowledge']=()=>{};
  await f.service.submitReview(f.e.id,{sha,decision:'reject',reason:'needs changes'});await settle(f.service);assert.equal(f.saved().humanReview?.decision,'reject');
  const second=f.service.submitReviewJob(f.e.id,input);assert.notEqual(second.reviewJob?.id,first.reviewJob?.id);await settle(f.service);assert.equal(f.saved().humanReview?.decision,'pass');
 }finally{await f.close();}
});

for(const remoteState of ['merged','closed'])test('queued review cannot resurrect an MR archived by its preceding background read: '+remoteState,async()=>{
 const f=fixture(),held=deferred();f.state.hold=held.promise;
 try{
  f.service.refreshRemoteStates();const accepted=f.service.submitReviewJob(f.e.id,input);assert.equal(accepted.reviewJob?.status,'queued');
  f.state.remoteState=remoteState;held.release();await settle(f.service);
  assert.equal(f.saved().phase,remoteState==='merged'?'DONE':'CLOSED');assert.equal(f.saved().reviewJob?.status,'failed');assert.equal(f.saved().humanReview,undefined);
  assert.equal(f.calls.some(args=>['approve-review','approve','merge'].includes(args[2]??'')),false);
 }finally{held.release();await f.close();}
});

test('a late knowledge lookup only updates the title and cannot resurrect a finished review job',async()=>{
 const f=fixture(),held=deferred();f.state.knowledgeHold=held.promise;f.service.knowledge.queue=()=>{};
 try{
  f.service.submitReviewJob(f.e.id,{...input,reason:'confirmed after checking'});
  for(let i=0;i<200&&f.service['reserved'].size;i++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(f.saved().phase,'DONE');assert.equal(f.saved().reviewJob?.status,'completed');assert.equal(f.service['active'].size,0);
  held.release();await settle(f.service);
  assert.equal(f.saved().title,'late knowledge title');assert.equal(f.saved().phase,'DONE');assert.equal(f.saved().reviewJob?.status,'completed');assert.equal(f.saved().queued,false);
 }finally{held.release();await f.close();}
});

test('starting a queued review does not restore fields removed by its background predecessor',async()=>{
 const f=fixture(),backgroundHeld=deferred(),readHeld=deferred();f.state.hold=readHeld.promise;
 f.e.approvalPending={operationId:'old',action:'审核',sha,username:'owner'};f.store.putRecord('group-mr-entry',f.e.id,f.e);
 const background=f.service['enqueue'](f.e,async()=>{await backgroundHeld.promise;const latest=f.saved();delete latest.approvalPending;latest.title='background updated';f.service['save'](latest);},false,'background');
 f.service['stateJobs'].set(f.e.repo+':'+f.e.iid,background);
 try{
  f.service.submitReviewJob(f.e.id,input);backgroundHeld.release();await background;
  assert.equal(f.saved().reviewJob?.status,'checking');assert.equal(f.saved().approvalPending,undefined);assert.equal(f.saved().title,'background updated');
  readHeld.release();await settle(f.service);assert.equal(f.saved().phase,'DONE');
 }finally{backgroundHeld.release();readHeld.release();await f.close();}
});

for(const changedDuringIdentity of [false,true])test('approval requirements becoming pending refresh identity and recheck every write gate: '+changedDuringIdentity,async()=>{
 const f=fixture(),readGate=f.service['gate'].bind(f.service);let reads=0;
 f.service['gate']=async e=>{const gate=await readGate(e);return ++reads<=2?{...gate,approval_reviewers_required_passed:true,approval_approvers_required_passed:true}:gate;};
 if(changedDuringIdentity){f.state.mutateAt='user-view';f.state.mutation='notes';}
 try{
  f.service.submitReviewJob(f.e.id,input);await settle(f.service);
  assert.equal(f.calls.filter(args=>args[1]==='user').length,1);
  if(changedDuringIdentity){assert.equal(f.saved().reviewJob?.status,'failed');assert.equal(f.calls.some(args=>['approve-review','approve','merge'].includes(args[2]??'')),false);}
  else{assert.equal(f.saved().phase,'DONE');assert.equal(f.saved().reviewSkipped,undefined);for(const action of ['approve-review','approve','merge'])assert.equal(f.calls.filter(args=>args[2]===action).length,1);}
 }finally{await f.close();}
});

test('a gate becoming satisfied during fallback identity lookup does not repeat approval writes',async()=>{
 const f=fixture(),readGate=f.service['gate'].bind(f.service);let reads=0;
 f.service['gate']=async e=>{const gate=await readGate(e);return ++reads===3?gate:{...gate,approval_reviewers_required_passed:true,approval_approvers_required_passed:true,merge_gate_passed:true};};
 try{f.service.submitReviewJob(f.e.id,input);await settle(f.service);assert.equal(f.saved().phase,'DONE');assert.equal(f.calls.filter(args=>args[1]==='user').length,1);assert.equal(f.calls.some(args=>['approve-review','approve'].includes(args[2]??'')),false);assert.equal(f.calls.filter(args=>args[2]==='merge').length,1);}
 finally{await f.close();}
});
