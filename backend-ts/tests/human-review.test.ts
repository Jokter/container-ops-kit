import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {TaskStore} from '../src/platform/store.js';
import {GroupMrService,type Entry} from '../src/modules/automation/group-mr.js';
import {ReviewKnowledge,type HumanReview} from '../src/modules/automation/review-knowledge.js';
import type {runProcess} from '../src/infrastructure/process.js';
const sha='a'.repeat(40),cfg={enabled:false,groupId:'123456789',authorizedSender:'owner123',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10};
function entry():Entry{return{id:randomUUID(),repo:'MAE-M/Access/Demo',iid:'1',url:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/1',sha,previousSha:'',messageId:'1',sender:'developer',shortcut:false,piReview:{source:'codehub',sha,discussionKey:'[]',summary:'检视完成',ok:true,resolvedDiscussionIds:[]},phase:'PIPELINE',status:'',detail:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),writePending:'',events:[]};}
for(const scenario of ['pass','reject','changed','comments','pipeline','duplicate','reply-failed'] as const)test('human review gate: '+scenario,async()=>{
 const store=new TaskStore(':memory:');let head=sha,merged=false,blocked=false;const writes:string[]=[];
 const execute:typeof runProcess=async(args,_dir,_timeout,_log,_line,input)=>{const action=args[2];let data:unknown={};
  if(action==='view')data={iid:1,state:merged?'merged':'opened',sha:head};
  if(action==='gate')data={ci_state_passed:!(blocked&&scenario==='pipeline'),approval_reviewers_required_passed:true,approval_approvers_required_passed:true,merge_gate_passed:true};
  if(action==='pipeline')data=[{id:1,sha:head,status:blocked&&scenario==='pipeline'?'failed':'success'}];
  if(action==='review')data=blocked&&scenario==='comments'?[{id:'new',resolved:false,notes:[{body:'new issue'}]}]:[];
  if(action==='merge'){assert.equal(input,'y\n');writes.push('merge');merged=true;}
  if(action==='send-to-group')data={resultCode:scenario==='reply-failed'?1:0};
  return{exitCode:0,output:JSON.stringify(data)};
 };
 const service=new GroupMrService(store,execute),e=entry();service.configure(cfg);
 try{store.putRecord('group-mr-entry',e.id,e);await service['process'](e,cfg);assert.equal(e.phase,'HUMAN');assert.equal(e.notification?.status,'unconfirmed');assert.deepEqual(writes,[]);
  if(scenario==='changed')head='b'.repeat(40);blocked=true;
  if(scenario==='changed'){await assert.rejects(service.submitReview(e.id,{sha,decision:'pass',reason:''}),/提交已变化/);assert.equal(service.knowledge.reviews().length,0);}
  else{const response=await service.submitReview(e.id,{sha,decision:scenario==='reject'?'reject':'pass',reason:scenario==='reject'?'业务语义不兼容':''});assert.equal(response.humanReview?.sha,sha);if(scenario==='duplicate')await assert.rejects(service.submitReview(e.id,{sha,decision:'pass',reason:''}));await Promise.allSettled(service['background']);assert.equal(service.knowledge.reviews().length,1);assert.equal(merged,['pass','duplicate','reply-failed'].includes(scenario));}
  if(scenario==='reply-failed'){assert.equal(service.list()[0]?.phase,'DONE');assert.equal(service.list()[0]?.reply?.status,'unconfirmed');}
  if(!['pass','duplicate','reply-failed'].includes(scenario))assert.deepEqual(writes,[]);
 }finally{await service.close();store.close();}
});
test('waiting human review survives restart without replay, stale superseded record rejects',async()=>{
 const store=new TaskStore(':memory:'),e={...entry(),phase:'HUMAN' as const};store.putRecord('group-mr-entry',e.id,e);const service=new GroupMrService(store,async()=>{throw Error('must not execute');});
 try{assert.equal(service.list()[0]?.phase,'HUMAN');e.supersededBy='new';store.putRecord('group-mr-entry',e.id,e);await assert.rejects(service.submitReview(e.id,{sha,decision:'pass',reason:''}),/替代/);}finally{await service.close();store.close();}
});
test('knowledge merges identical evidence, preserves conflicts, and enforces service cap',async()=>{
 const store=new TaskStore(':memory:');let output={items:[{title:'兼容性',content:'检查缺省行为',scope:'接口参数',conflict:false,targetId:undefined as string|undefined}]};
 const knowledge=new ReviewKnowledge(store,async args=>{assert.ok(args.includes('--no-tools'));return{exitCode:0,output:JSON.stringify(output)};});
 const review=():HumanReview=>({id:randomUUID(),entryId:'entry',repo:'Demo',iid:'1',url:'',sha,decision:'pass',reason:'缺省行为保持兼容',category:'',time:new Date().toISOString(),waitMs:100,actor:'平台人工审核',knowledgeStatus:'pending'});
 try{const a=review();knowledge.saveReview(a);knowledge.queue(a,'diff');await Promise.allSettled(knowledge['jobs']);const first=knowledge.list()[0]!;assert.equal(first.status,'active');
  output.items[0]!.targetId=first.id;const b=review();knowledge.saveReview(b);knowledge.queue(b,'diff');await Promise.allSettled(knowledge['jobs']);assert.equal(knowledge.list().length,1);assert.equal(knowledge.list()[0]?.sources.length,2);
  output.items[0]!.content='改成不同规则';const c=review();knowledge.saveReview(c);knowledge.queue(c,'diff');await Promise.allSettled(knowledge['jobs']);assert.equal(knowledge.context('Demo')[0]?.content,'检查缺省行为');assert.equal(knowledge.list().filter(k=>k.status==='pending').length,1);
  for(let i=0;i<19;i++)store.putRecord('service-knowledge',String(i),{...first,id:String(i)});const pending=knowledge.list().find(k=>k.status==='pending')!;assert.throws(()=>knowledge.update(pending.id,{title:pending.title,content:pending.content,scope:pending.scope,status:'active',revision:pending.revision}),/20/);
 }finally{await knowledge.close();store.close();}
});
test('human reminder uses MCP once, has no group reminder, and restart does not resend',async()=>{
 const store=new TaskStore(':memory:'),e=entry();let sends=0;const previous=process.env.WELINK_TOKEN;process.env.WELINK_TOKEN='test-only';
 const execute:typeof runProcess=async args=>{assert.notEqual(args[0],'welink-cli');let value:unknown=[];if(args[2]==='view')value={iid:1,state:'opened',sha};if(args[2]==='gate')value={ci_state_passed:true};if(args[2]==='pipeline')value=[{id:1,sha,status:'success'}];return{exitCode:0,output:JSON.stringify(value)};};
 const notifier={send:async(receiver:string,text:string)=>{assert.equal(receiver,'owner123');assert.match(text,/待人工审核/);sends++;}};
 const service=new GroupMrService(store,execute,undefined,undefined,notifier);
 try{store.putRecord('group-mr-entry',e.id,e);await service['process'](e,cfg);await service['process'](e,cfg);assert.equal(sends,1);assert.equal(e.notification?.status,'sent');await service.close();const restarted=new GroupMrService(store,execute,undefined,undefined,notifier);assert.equal(restarted.list()[0]?.phase,'HUMAN');assert.equal(sends,1);await restarted.close();}
 finally{if(previous===undefined)delete process.env.WELINK_TOKEN;else process.env.WELINK_TOKEN=previous;await service.close();store.close();}
});
test('knowledge uses latest history and scope changes stay pending until old knowledge is disabled',async()=>{
 const store=new TaskStore(':memory:');const base={id:randomUUID(),repo:'Demo',title:'兼容',content:'检查缺省行为',scope:'北向接口',status:'active' as const,sources:[],updatedAt:new Date().toISOString(),revision:1};store.putRecord('service-knowledge',base.id,base);
 let historyIds:string[]=[];let targetId:string=base.id;
 const knowledge=new ReviewKnowledge(store,async(_args,_cwd,_timeout,_log,_line,input)=>{const payload=JSON.parse(input!.slice(input!.indexOf('\n')+1)) as {history:HumanReview[]};historyIds=payload.history.map(r=>r.id);return{exitCode:0,output:JSON.stringify({items:[{title:base.title,content:base.content,scope:'全部接口',targetId,conflict:false}]})};});
 const review=(id:string,time:string):HumanReview=>({id,entryId:'entry',repo:'Demo',iid:'1',url:'',sha,decision:'pass',reason:'已核对',category:'',time,waitMs:1,actor:'平台人工审核',knowledgeStatus:'done'});
 try{for(let i=1;i<=25;i++)knowledge.saveReview(review(String(i),`2026-09-${String(i).padStart(2,'0')}T00:00:00Z`));const current=review('current','2026-09-26T00:00:00Z');knowledge.saveReview(current);knowledge.queue(current,'diff');await Promise.allSettled(knowledge['jobs']);assert.equal(historyIds.length,20);assert.equal(historyIds[0],'25');assert.ok(!historyIds.includes('1'));
 let pending=knowledge.list().find(k=>k.status==='pending')!;assert.ok(pending);targetId=pending.id;const again=review('again','2026-09-27T00:00:00Z');knowledge.saveReview(again);knowledge.queue(again,'diff');await Promise.allSettled(knowledge['jobs']);pending=knowledge.list().find(k=>k.id===targetId)!;assert.equal(pending.conflictsWith,base.id);assert.equal(knowledge.context('Demo')[0]?.scope,'北向接口');const input={title:pending.title,content:pending.content,scope:pending.scope,status:'active',revision:pending.revision};assert.throws(()=>knowledge.update(pending.id,input),/冲突/);knowledge.update(base.id,{title:base.title,content:base.content,scope:base.scope,status:'disabled',revision:base.revision});knowledge.update(pending.id,input);assert.equal(knowledge.context('Demo').length,1);assert.equal(knowledge.context('Demo')[0]?.scope,'全部接口');
 }finally{await knowledge.close();store.close();}
});

for(const scenario of ['review-denied','approve-denied','merge-denied','review-absent','approve-absent','approve-timeout','merge-timeout','merged'] as const)test('human-approved MR replies for each permission failure and merge success: '+scenario,async()=>{
 const store=new TaskStore(':memory:'),sent:string[]=[],writes:string[]=[];let merged=false;
 const role=scenario.startsWith('review')?'检视':scenario.startsWith('approve')?'审核':'合并';
 const service=new GroupMrService(store,async args=>{
  const action=args[2];let value:unknown={};
  if(action==='view')value={iid:1,state:merged?'merged':'opened',sha,approval_merge_request_reviewers:scenario==='review-absent'?[]:[{username:'owner123'}],approval_merge_request_approvers:scenario==='approve-absent'?[]:[{username:'owner123'}]};
  if(args[1]==='user')value={username:'owner123'};
  if(action==='gate')value={ci_state_passed:true,quality_gate:{passed:true},conflict_passed:true,approval_reviewers_required_passed:!scenario.startsWith('review'),approval_approvers_required_passed:!scenario.startsWith('approve'),merge_gate_passed:true};
  if(action==='pipeline')value=[{id:1,status:'success',sha}];if(action==='review')value=[];
  if(['approve-review','approve','merge'].includes(action??'')){writes.push(action!);if(scenario.endsWith('timeout'))return {exitCode:124,output:'timeout'};if(scenario.endsWith('denied')&&action!=='merge'||scenario==='merge-denied')return {exitCode:1,output:'HTTP 403 forbidden'};merged=true;}
  if(action==='send-to-group'&&!args.includes('--help')){sent.push(args[args.indexOf('--text')+1]!);value={resultCode:0};}
  return {exitCode:0,output:JSON.stringify(value)};
 });
 service.configure(cfg);const e=entry();e.phase='HUMAN';store.putRecord('group-mr-entry',e.id,e);
 try{await service.submitReview(e.id,{sha,decision:'pass',reason:''});while(service['background'].size)await Promise.allSettled(service['background']);
  assert.equal(sent.length,1);assert.ok(sent[0]?.includes(e.url));assert.ok(sent[0]?.includes('发送人：developer'));assert.ok(!sent[0]?.includes('无检视权限'));
  if(scenario==='merged'||scenario.startsWith('review')){assert.equal(service.list()[0]?.phase,'DONE');assert.match(sent[0]??'',/MR 已合入/);}
  else if(scenario.endsWith('timeout')){assert.equal(service.list()[0]?.phase,'INTERRUPTED');assert.equal(service.list()[0]?.writePending,role);assert.ok(sent[0]?.includes(role==='合并'?'无法合入':'无法审核'));assert.equal(writes.length,1);}
  else{assert.equal(service.list()[0]?.phase,'NO_PERMISSION');assert.ok(sent[0]?.includes('无'+role+'权限'));assert.equal(merged,false);assert.equal(writes.length,scenario.endsWith('absent')?0:1);}
 }finally{await service.close();store.close();}
});
