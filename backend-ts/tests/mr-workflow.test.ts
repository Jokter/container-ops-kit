import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {MrConfiguration} from '../src/modules/autout/mr-settings.js';
import {MrWorkflow,newTracking,rejectedAuthorizedPeople,type MrHooks} from '../src/modules/autout/mr-workflow.js';
import {parseMr,mrIid} from '../src/modules/autout/mr-codehub.js';
import type {AutoUtTask} from '../src/modules/autout/autout.js';
const now=Date.parse('2026-09-22T01:00:00Z');
function fixture(){
 const store=new TaskStore(':memory:'),config=new MrConfiguration(store).snapshot('Demo');store.close();
 config.roles={reviewers:['r123'],approvers:['a123'],assignees:['m123']};
 const task:AutoUtTask={id:'task',repository:'Demo',username:'owner1',ticket:'DTS123',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:'/tmp',status:'MR_PENDING',nextStage:'TRACK',executionMode:'AUTOMATIC',progress:92,attempts:1,message:'',pullRequestUrl:'https://codehub.example/demo/merge_requests/7',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),history:[],liveEvents:[],liveSequence:0,governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,mrState:'PENDING'},mr:newTracking(config)};
 task.mr!.iid='7';task.mr!.sha='sha1';task.mr!.phase='PIPELINE';
 const view={iid:7,id:900,state:'opened',sha:'sha1',source_branch:'repair',target_branch:'main',web_url:task.pullRequestUrl,title:'工单标题',e2e_issues:[{id:'DTS123',title:'工单标题'}],approval_merge_request_reviewers:[{username:'r123',approved:false}],approval_merge_request_approvers:[{username:'a123',approved:false}],merge_request_assignee_list:[{username:'m123',approved:false}]};
 const gate={ci_state_passed:true,quality_gate:{passed:true},approval_reviewers_required_passed:false,approval_approvers_required_passed:false,conflict_passed:true};
 const pipeline={id:10,status:'success',sha:'sha1'};const calls:string[][]=[];let repairCount=0,failSend=false,failUpdate=false;
 const hooks:MrHooks={save:()=>{},event:()=>{},state:(t,s,m)=>{t.status=s;t.message=m;},repair:async()=>{repairCount++;return 'sha2';},run:async(_t,args)=>{
  calls.push(args);
  if(args[0]==='welink-cli')return {exitCode:failSend?1:0,output:failSend?'timeout':'{"resultCode":"0"}'};
  if(args[1]==='mr'&&args[2]==='view')return {exitCode:0,output:'log before\n'+JSON.stringify(view,null,2)};
  if(args[1]==='mr'&&args[2]==='gate')return {exitCode:0,output:JSON.stringify(gate)};
  if(args[1]==='mr'&&args[2]==='pipeline')return {exitCode:0,output:JSON.stringify([pipeline])};
  if(args[1]==='mr'&&args[2]==='list')return {exitCode:0,output:JSON.stringify([view])};
  if(args[1]==='pipeline'&&args[2]==='view')return {exitCode:0,output:JSON.stringify(pipeline)};
  if(args[1]==='pipeline'&&args[2]==='failure')return {exitCode:0,output:JSON.stringify({failures:[{file:'src/test/java/DemoTest.java',message:'AssertionError expected result'}]})};
  if(args[1]==='mr'&&args[2]==='update'){if(failUpdate)throw Error('role permission denied');if(args.includes('--approval-reviewers'))view.approval_merge_request_reviewers=[{username:args[args.indexOf('--approval-reviewers')+1]!,approved:false}];return {exitCode:0,output:JSON.stringify(view)};}
  throw Error('Unexpected command '+args.join(' '));
 }};
 return {task,view,gate,pipeline,calls,hooks,workflow:new MrWorkflow(hooks),repairs:()=>repairCount,setFailSend:()=>{failSend=true;},setFailUpdate:()=>{failUpdate=true;}};
}
test('mixed multiline MR output distinguishes upload IID from view ID',()=>{
 assert.equal(mrIid(parseMr('info\n{\n"id":7,"mr_url":"https://codehub.example/demo/merge_requests/7"\n}')), '7');
 assert.equal(mrIid(parseMr('{"id":900,"iid":7}')),'7');assert.throws(()=>mrIid(parseMr('{"id":900}')),/IID/);
});
test('settings persist roles, repository overrides and reject invalid accounts',()=>{
 const store=new TaskStore(':memory:');try{const service=new MrConfiguration(store),config=service.get();config.roles.reviewers=['r123'];config.repositories=[{repository:'Demo',roles:{approvers:['a123']}}];service.save(config);assert.deepEqual(service.snapshot('demo').roles,{reviewers:['r123'],approvers:['a123'],assignees:[]});assert.throws(()=>service.save({...config,roles:{...config.roles,reviewers:['bad;command']}}));}finally{store.close();}
});
test('phase notifications run at night and weekends despite legacy work hours',async()=>{
 for(const time of ['2026-09-22T15:00:00Z','2026-09-26T15:00:00Z']){
  const f=fixture();f.task.mr!.config.workHours={weekdaysOnly:true,start:9,end:18};
  const at=Date.parse(time);await f.workflow.tick(f.task,at);
  f.gate.approval_reviewers_required_passed=true;await f.workflow.tick(f.task,at+60000);
  f.gate.approval_approvers_required_passed=true;await f.workflow.tick(f.task,at+120000);
  assert.deepEqual(f.calls.filter(c=>c[0]==='welink-cli').map(c=>c[c.indexOf('--receiver')+1]),['r123','a123','m123']);
 }
});
test('reminders and escalation use elapsed minutes across weekends',async()=>{
 const f=fixture();f.task.mr!.config.workHours={weekdaysOnly:true,start:9,end:18};
 const at=Date.parse('2026-09-25T15:00:00Z');
 for(const minutes of [0,119,120,239,240,241])await f.workflow.tick(f.task,at+minutes*60000);
 const sent=f.calls.filter(c=>c[0]==='welink-cli');
 assert.equal(sent.filter(c=>c.includes('r123')).length,2);assert.equal(sent.filter(c=>c.includes('owner1')).length,1);
});
test('night notifications still respect the global switch',async()=>{
 const f=fixture();f.task.mr!.config.notifications=false;await f.workflow.tick(f.task,Date.parse('2026-09-26T15:00:00Z'));
 assert.ok(!f.calls.some(c=>c[0]==='welink-cli'));
});
test('pipeline success is not task completion; stages notify actual pending members',async()=>{
 const f=fixture();await f.workflow.tick(f.task,now);assert.equal(f.task.status,'MR_PENDING');assert.equal(f.task.mr!.phase,'REVIEW');assert.equal(f.calls.filter(c=>c[0]==='welink-cli').length,1);
 f.gate.approval_reviewers_required_passed=true;await f.workflow.tick(f.task,now+300000);assert.equal(f.task.mr!.phase,'APPROVE');
 f.gate.approval_approvers_required_passed=true;await f.workflow.tick(f.task,now+600000);assert.equal(f.task.mr!.phase,'MERGE');assert.notEqual(f.task.status,'RESOLVED');
 f.view.state='merged';await f.workflow.tick(f.task,now+900000);assert.equal(f.task.status,'RESOLVED');assert.equal(f.task.progress,100);assert.equal(f.task.governance!.mrState,'MERGED');
});
test('MR closure terminates every phase without reporting completion',async()=>{
 const f=fixture();f.view.state='closed';await f.workflow.tick(f.task,now);assert.equal(f.task.status,'MR_CLOSED');assert.equal(f.task.governance!.mrState,'CLOSED');assert.equal(f.calls.filter(c=>c[0]==='welink-cli').length,0);
});
test('reminders sent at most twice and creator escalation once, across repeated polls',async()=>{
 const f=fixture();for(const minutes of [0,1,120,121,240,241,300])await f.workflow.tick(f.task,now+minutes*60000);
 const sent=f.calls.filter(c=>c[0]==='welink-cli');assert.equal(sent.filter(c=>c.includes('r123')).length,2);assert.equal(sent.filter(c=>c.includes('owner1')).length,1);
});
test('uncertain notification is persisted and not resent after reconstruction',async()=>{
 const f=fixture();f.setFailSend();await f.workflow.tick(f.task,now);const restored=structuredClone(f.task);const workflow=new MrWorkflow(f.hooks);await workflow.tick(restored,now+300000);assert.equal(f.calls.filter(c=>c[0]==='welink-cli'&&c.includes('r123')).length,1);
});
test('running or stale pipeline never triggers a repair',async()=>{
 const f=fixture();f.pipeline.status='running';f.gate.ci_state_passed=false;await f.workflow.tick(f.task,now);assert.equal(f.repairs(),0);f.pipeline.status='failed';f.pipeline.sha='old';await f.workflow.tick(f.task,now+60000);assert.equal(f.repairs(),0);
});
test('failed pipeline produces only one repair and waits for the new remote SHA',async()=>{
 const f=fixture();f.pipeline.status='failed';f.gate.ci_state_passed=false;await f.workflow.tick(f.task,now);assert.equal(f.repairs(),1);assert.equal(f.task.mr!.awaitingSha,'sha2');await f.workflow.tick(f.task,now+60000);assert.equal(f.repairs(),1);assert.equal(f.task.mr!.paused,false);
 f.view.sha='sha2';f.pipeline.sha='sha2';f.pipeline.id=11;f.pipeline.status='running';await f.workflow.tick(f.task,now+120000);assert.equal(f.repairs(),1);assert.equal(f.task.mr!.awaitingSha,undefined);
});
test('repair cap and identical successive failures pause automation',async()=>{
 const f=fixture();f.pipeline.status='failed';f.task.mr!.rounds=3;await f.workflow.tick(f.task,now);assert.equal(f.repairs(),0);assert.equal(f.task.mr!.paused,true);
 const g=fixture();g.pipeline.status='failed';await g.workflow.tick(g.task,now);g.view.sha='sha2';g.pipeline.sha='sha2';g.pipeline.id=11;await g.workflow.tick(g.task,now+60000);assert.equal(g.repairs(),1);assert.equal(g.task.mr!.paused,true);
});
test('recover upload finds an existing MR without repeating the write',async()=>{
 const f=fixture();f.task.mr!.iid='';f.task.mr!.writePending='upload';assert.equal(await f.workflow.recoverUpload(f.task),true);assert.equal(f.task.mr!.iid,'7');assert.equal(f.task.mr!.writePending,undefined);assert.ok(!f.calls.some(c=>c.includes('upload')));
});
test('MR recovery queries lowercase opened and ignores historical or unrelated MRs',async()=>{
 for(const state of ['closed','merged','locked']){
  const f=fixture();f.task.mr!.iid='';f.task.pullRequestUrl='';f.view.state=state;
  assert.equal(await f.workflow.recoverUpload(f.task),false,state);assert.equal(f.task.mr!.iid,'');
  const command=f.calls[0]!;assert.equal(command[command.indexOf('--state')+1],'opened');
 }
 const f=fixture();f.task.mr!.iid='';f.hooks.run=async()=>({exitCode:0,output:JSON.stringify([
  {...f.view,iid:1,state:'merged'}, {...f.view,iid:2,state:'closed'},
  {...f.view,iid:3,source_branch:'another'}, {...f.view,iid:4,target_branch:'another'}, f.view
 ])});
 assert.equal(await f.workflow.recoverUpload(f.task),true);assert.equal(f.task.mr!.iid,'7');
});
test('MR recovery permits an empty opened list but refuses ambiguous opened matches',async()=>{
 const f=fixture();f.hooks.run=async()=>({exitCode:0,output:'[]'});assert.equal(await f.workflow.recoverUpload(f.task),false);
 f.hooks.run=async()=>({exitCode:0,output:JSON.stringify([f.view,{...f.view,iid:8}])});
 await assert.rejects(f.workflow.recoverUpload(f.task),/多个 opened MR/);
});

test('setup failures preserve IID and stop on unauthorized personnel',async()=>{
 const f=fixture();f.task.mr!.phase='SETUP';f.view.approval_merge_request_reviewers=[];f.setFailUpdate();await assert.rejects(f.workflow.setup(f.task),/permission denied/);assert.equal(f.task.mr!.iid,'7');assert.equal(f.task.mr!.writePending,'reviewers');await f.workflow.tick(f.task,now);assert.equal(f.task.mr!.paused,true);assert.equal(f.calls.filter(c=>c.includes('update')).length,1);
});
test('setup resumes confirmed steps and matches the actual issue number',async()=>{
 const f=fixture();f.task.mr!.phase='SETUP';f.view.e2e_issues.unshift({id:'DTS999',title:'其他单号'});await f.workflow.setup(f.task);assert.equal(f.task.mr!.phase,'PIPELINE');assert.equal(f.task.nextStage,'TRACK');assert.ok(!f.calls.some(c=>c.includes('update')));
});

test('explicit unauthorized approver is excluded only for this MR and remaining approver is verified',async()=>{
 const f=fixture();f.task.mr!.phase='SETUP';f.task.mr!.config.roles.approvers=['x00660165','z30003938'];
 const original=structuredClone(f.task.mr!.config),run=f.hooks.run,updates:string[][]=[];
 f.hooks.run=async(t,args,label,required)=>{
  if(args.includes('--approval-approvers')){
   updates.push(args);const people=args[args.indexOf('--approval-approvers')+1]!;
   if(people.includes('z30003938'))throw Error('配置MRapprovers失败，退出码 1：error: HTTP 400: The approval approvers must be in the authorized user list. Please check the following users: zhangzeze 30003938 (CH.00201400)');
   f.view.approval_merge_request_approvers=people.split(',').map(username=>({username,approved:false}));
   return {exitCode:0,output:'{}'};
  }
  return run(t,args,label,required);
 };
 await f.workflow.setup(f.task);
 assert.deepEqual(updates.map(c=>c[c.indexOf('--approval-approvers')+1]),['x00660165,z30003938','x00660165']);
 assert.deepEqual(f.task.mr!.config,original);assert.deepEqual(f.task.mr!.rejectedRoles,{approvers:['z30003938']});
 assert.equal(f.task.mr!.phase,'PIPELINE');assert.equal(f.task.mr!.writePending,undefined);
 const restored=structuredClone(f.task);restored.mr!.setup.approvers=false;
 await new MrWorkflow(f.hooks).setup(restored);assert.equal(updates.length,2);
});
test('all explicitly rejected approvers stop without submitting an empty role list',async()=>{
 const f=fixture();f.task.mr!.config.roles.approvers=['z30003938'];const run=f.hooks.run;let writes=0;
 f.hooks.run=async(t,args,label,required)=>{
  if(args.includes('--approval-approvers')){writes++;throw Error('HTTP 400: The approval approvers must be in the authorized user list. Please check the following users: zhangzeze 30003938 (CH.00201400)');}
  return run(t,args,label,required);
 };
 await assert.rejects(f.workflow.setup(f.task),/均不在授权名单/);
 await assert.rejects(f.workflow.setup(f.task),/均不在授权名单/);
 assert.equal(writes,1);assert.deepEqual(f.task.mr!.config.roles.approvers,['z30003938']);
});
test('uncertain personnel update never removes users or resubmits',async()=>{
 const f=fixture();f.task.mr!.config.roles.approvers=['z30003938'];const run=f.hooks.run;let writes=0;
 f.hooks.run=async(t,args,label,required)=>{if(args.includes('--approval-approvers')){writes++;throw Error('HTTP 500: connection timeout');}return run(t,args,label,required);};
 await assert.rejects(f.workflow.setup(f.task),/timeout/);await assert.rejects(f.workflow.setup(f.task),/结果未确认/);
 assert.equal(writes,1);assert.equal(f.task.mr!.rejectedRoles,undefined);
});

test('authorization rejection matching requires an exact unambiguous account and role',()=>{
 const message='HTTP 400: The approval approvers must be in the authorized user list. Please check the following users: zhangzeze 30003938 (CH.00201400)';
 assert.deepEqual(rejectedAuthorizedPeople(message,'approvers',['x00660165','z30003938']),['z30003938']);
 assert.deepEqual(rejectedAuthorizedPeople(message,'approvers',['z300039380']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(message,'approvers',['z30003938','x30003938']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(message,'reviewers',['z30003938']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(message.replace('CH.00201400','CH.OTHER'),'approvers',['z30003938']),[]);
});

test('only explicit MR absence permits automatic unblocking, never generic 404 or permission errors',async()=>{
 const {explicitlyMissingMr}=await import('../src/modules/autout/mr-codehub.js');
 assert.equal(explicitlyMissingMr(1,'error: HTTP 404: Merge request not found'),true);
 for(const output of ['error: HTTP 404: Not found','error: HTTP 403: Merge request not found','error: HTTP 404: Project not found','error: HTTP 404: Merge request not found or access denied','{}'])assert.equal(explicitlyMissingMr(1,output),false,output);
 assert.equal(explicitlyMissingMr(0,'error: HTTP 404: Merge request not found'),false);
});
