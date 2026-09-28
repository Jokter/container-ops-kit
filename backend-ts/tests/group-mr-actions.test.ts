import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {GroupMrService,groupMrRoutes,type Entry} from '../src/modules/automation/group-mr.js';
import {TaskStore} from '../src/platform/store.js';
const sha='a'.repeat(40);
const cfg={enabled:false,groupId:'',authorizedSender:'owner',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10};
function entry():Entry{return{id:randomUUID(),repo:'MAE-M/Access/Demo',iid:'1',url:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/1',sha,previousSha:'',messageId:'1',sender:'developer',shortcut:false,humanReviewRequired:true,humanReview:{id:randomUUID(),entryId:'',repo:'MAE-M/Access/Demo',iid:'1',url:'',time:new Date().toISOString(),sha,decision:'pass',reason:'',category:'',waitMs:0,actor:'平台人工审核',knowledgeStatus:'skipped'},piReview:{sha,source:'codehub',discussionKey:'[]',ok:true,summary:'通过',findings:[],resolvedDiscussionIds:[]},phase:'NO_PERMISSION',status:'之前无法合入',detail:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),writePending:'',pipelinePassed:true,events:[]};}
function fixture(mode:string){
 const store=new TaskStore(':memory:'),writes:string[][]=[];let merged=false;
 const service=new GroupMrService(store,async args=>{
  let value:unknown={};const action=args[2];
  if(args[1]==='user')value={username:'owner'};
  else if(action==='view')value={iid:1,state:mode==='closed'?'closed':mode==='already-merged'||merged?'merged':'opened',sha:mode==='changed'?'b'.repeat(40):sha,approval_merge_request_reviewers:[{username:'owner'}],approval_merge_request_approvers:[{username:'owner'}],merge_request_assignee_list:[{username:'owner'}]};
  else if(action==='gate')value={ci_state_passed:mode!=='pipeline',quality_gate:{passed:mode!=='quality'},conflict_passed:mode!=='conflict',approval_reviewers_required_passed:true,approval_approvers_required_passed:true,merge_gate_passed:!['gate','conflict'].includes(mode)};
  else if(action==='pipeline')value=[{id:1,sha,status:mode==='pipeline'?'failed':'success'}];
  else if(action==='review')value=mode==='comments'?[{id:'open',resolved:false,notes:[{body:'fix it'}]}]:[];
  else if(action==='merge'){writes.push([...args]);if(mode==='uncertain')return{exitCode:124,output:'timeout'};if(mode==='denied')return{exitCode:1,output:'HTTP 403 forbidden'};merged=true;}
  else if(action==='send-to-group')value={resultCode:0};
  else if(action==='update'||args[0]==='pi')throw Error('must not add roles or rerun Agent in this fixture');
  return{exitCode:0,output:JSON.stringify(value)};
 });
 store.putRecord('group-mr-config','main',cfg);
 const e=entry();store.putRecord('group-mr-entry',e.id,e);return {store,service,e,writes};
}
for(const mode of ['success','changed','closed','already-merged','pipeline','quality','conflict','comments','gate','denied','uncertain'])test('manual merge reuses remote gates and never retries a write: '+mode,async()=>{
 const {store,service,e,writes}=fixture(mode);
 try{
  const result=await service.mergeRecord(e.id,{sha,confirmed:true});
  assert.equal(writes.length,['success','denied','uncertain'].includes(mode)?1:0);
  if(['success','already-merged'].includes(mode))assert.equal(result.phase,'DONE');else if(mode==='closed')assert.equal(result.phase,'CLOSED');else assert.notEqual(result.phase,'DONE');
  if(writes.length)assert.ok(writes[0]!.includes('-y'));
  if(['success','already-merged','closed','uncertain'].includes(mode)){await assert.rejects(service.mergeRecord(e.id,{sha,confirmed:true}));assert.equal(writes.length,['success','denied','uncertain'].includes(mode)?1:0);}
  if(mode==='uncertain')assert.equal(result.writePending,'合并');
 }finally{await service.close();store.close();}
});
for(const mode of ['human','rejected','stale-human','no-agent','stale-agent','pending-write','superseded','hidden','wrong-sha','unconfirmed'])test('manual merge rejects unsafe or stale selections before execution: '+mode,async()=>{
 const {store,service,e,writes}=fixture('success');
 if(mode==='human')delete e.humanReview;
 if(mode==='rejected')e.humanReview!.decision='reject';
 if(mode==='stale-human')e.humanReview!.sha='b'.repeat(40);
 if(mode==='no-agent')delete e.piReview;
 if(mode==='stale-agent')e.piReview!.sha='b'.repeat(40);
 if(mode==='pending-write')e.writePending='审核';
 if(mode==='superseded')e.supersededBy=randomUUID();
 if(mode==='hidden')store.putRecord('group-mr-hidden',e.id,{id:e.id});
 store.putRecord('group-mr-entry',e.id,e);
 try{await assert.rejects(service.mergeRecord(e.id,{sha:mode==='wrong-sha'?'b'.repeat(40):sha,confirmed:mode!=='unconfirmed'}));assert.equal(writes.length,0);}
 finally{await service.close();store.close();}
});
test('merge endpoint requires explicit confirmation and blocks duplicate in-flight submissions',async()=>{
 const {store,service,e}=fixture('success'),app=Fastify();groupMrRoutes(app,service);
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);let executions=0;
 service['executeEntry']=async()=>{executions++;await held;};
 try{
  const invalid=await app.inject({method:'POST',url:'/api/automation/group-mr/records/'+e.id+'/merge',payload:{sha}});assert.ok(invalid.statusCode>=400);assert.equal(executions,0);
  const first=service.mergeRecord(e.id,{sha,confirmed:true});await assert.rejects(service.mergeRecord(e.id,{sha,confirmed:true}),/排队或执行|执行或排队/);assert.equal(executions,1);release();await first;
 }finally{release();await service.close();store.close();await app.close();}
});
