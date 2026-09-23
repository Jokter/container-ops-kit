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
 const pipeline={id:10,status:'success',sha:'sha1'};const calls:string[][]=[],progress:string[]=[];let repairCount=0,failSend=false,failUpdate=false;
 const hooks:MrHooks={loginWelink:async()=>true,notifySelf:async(t,message)=>{if(message.startsWith('UT 治理进展：')&&!message.includes('需要人工介入')){progress.push(message);return;}calls.push(['welink-mcp','--receiver',t.username,'--text',message]);},save:()=>{},event:()=>{},state:(t,s,m)=>{t.status=s;t.message=m;},repair:async()=>{repairCount++;return 'sha2';},run:async(_t,args)=>{
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
 return {task,view,gate,pipeline,calls,progress,hooks,workflow:new MrWorkflow(hooks),repairs:()=>repairCount,setFailSend:()=>{failSend=true;},setFailUpdate:()=>{failUpdate=true;}};
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
  assert.deepEqual(f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp')).map(c=>c[c.indexOf('--receiver')+1]),['r123','a123','m123']);
 }
});
test('reminders and escalation use elapsed minutes across weekends',async()=>{
 const f=fixture();f.task.mr!.config.workHours={weekdaysOnly:true,start:9,end:18};
 const at=Date.parse('2026-09-25T15:00:00Z');
 for(const minutes of [0,119,120,239,240,241])await f.workflow.tick(f.task,at+minutes*60000);
 const sent=f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp'));
 assert.equal(sent.filter(c=>c.includes('r123')).length,2);assert.equal(sent.filter(c=>c.includes('owner1')).length,1);
});
test('night notifications still respect the global switch',async()=>{
 const f=fixture();f.task.mr!.config.notifications=false;await f.workflow.tick(f.task,Date.parse('2026-09-26T15:00:00Z'));
 assert.ok(!f.calls.some(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp')));
});
test('pipeline success is not task completion; stages notify actual pending members',async()=>{
 const f=fixture();await f.workflow.tick(f.task,now);assert.equal(f.task.status,'MR_PENDING');assert.equal(f.task.mr!.phase,'REVIEW');assert.equal(f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp')).length,1);
 f.gate.approval_reviewers_required_passed=true;await f.workflow.tick(f.task,now+300000);assert.equal(f.task.mr!.phase,'APPROVE');
 f.gate.approval_approvers_required_passed=true;await f.workflow.tick(f.task,now+600000);assert.equal(f.task.mr!.phase,'MERGE');assert.notEqual(f.task.status,'RESOLVED');
 f.view.state='merged';await f.workflow.tick(f.task,now+900000);assert.equal(f.task.status,'RESOLVED');assert.equal(f.task.progress,100);assert.equal(f.task.governance!.mrState,'MERGED');
});
test('MR closure terminates every phase without reporting completion',async()=>{
 const f=fixture();f.view.state='closed';await f.workflow.tick(f.task,now);assert.equal(f.task.status,'MR_CLOSED');assert.equal(f.task.governance!.mrState,'CLOSED');assert.equal(f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp')).length,0);
});
test('reminders sent at most twice and creator escalation once, across repeated polls',async()=>{
 const f=fixture();for(const minutes of [0,1,120,121,240,241,300])await f.workflow.tick(f.task,now+minutes*60000);
 const sent=f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp'));assert.equal(sent.filter(c=>c.includes('r123')).length,2);assert.equal(sent.filter(c=>c.includes('owner1')).length,1);
});
test('uncertain notification is persisted and not resent after reconstruction',async()=>{
 const f=fixture();f.setFailSend();await f.workflow.tick(f.task,now);const restored=structuredClone(f.task);const workflow=new MrWorkflow(f.hooks);await workflow.tick(restored,now+300000);assert.equal(f.calls.filter(c=>(c[0]==='welink-cli'||c[0]==='welink-mcp')&&c.includes('r123')).length,1);
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

test('successful upload with short or non-JSON output confirms existing MR without another write',async()=>{
 for(const output of ['{}','{"id":7}','upload completed','[{"id":7}]']){
  const f=fixture();f.task.mr!.iid='';f.task.mr!.writePending='upload';
  await f.workflow.confirmUpload(f.task,output);
  assert.equal(f.task.mr!.iid,'7');assert.equal(f.task.mr!.writePending,undefined);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0]![2],'list');
 }
});
test('upload confirmation tolerates delayed visibility with bounded reads',async()=>{
 const f=fixture();let reads=0;const waits:number[]=[];
 f.hooks.run=async(_t,args)=>{assert.equal(args[2],'list');return{exitCode:0,output:JSON.stringify(++reads<3?[]:[f.view])};};
 await new MrWorkflow(f.hooks,async ms=>{waits.push(ms);}).confirmUpload(f.task,'{}');
 assert.equal(reads,3);assert.deepEqual(waits,[2000,2000]);assert.equal(f.task.mr!.iid,'7');
});
test('unconfirmed and ambiguous uploads preserve pending state without replay',async()=>{
 const f=fixture();f.task.mr!.iid='';f.task.mr!.writePending='upload';let reads=0;
 f.hooks.run=async()=>{reads++;return{exitCode:0,output:'[]'};};
 const flow=new MrWorkflow(f.hooks,async()=>{});await assert.rejects(flow.confirmUpload(f.task,'{}'),/暂未查到唯一/);
 assert.equal(reads,3);assert.equal(f.task.mr!.writePending,'upload');assert.equal(f.task.mr!.iid,'');
 f.hooks.run=async()=>({exitCode:0,output:JSON.stringify([f.view,{...f.view,iid:8}])});await assert.rejects(flow.confirmUpload(f.task,'{}'),/多个 opened/);
 assert.equal(f.task.mr!.writePending,'upload');
});
test('MR parsing accepts single-item arrays and rejects ambiguous arrays',()=>{
 assert.equal(mrIid(parseMr('[{"iid":7,"id":900}]')),'7');
 assert.throws(()=>parseMr('[{"iid":7},{"iid":8}]'),/多个 MR/);
});

const assigneeRejection='HTTP 400: The assignee user must be Committer or higher-level or setting in protected branches, or set the disable merge by self. Please check the following noAuthUsers: x00660165 (CH.00201400)';
test('all three roles exclude only explicitly rejected members for the current MR',async()=>{
 for(const role of ['reviewers','approvers','assignees'] as const){
  const f=fixture();f.task.mr!.phase='SETUP';f.task.mr!.config.roles[role]=['x00660165','l00831259'];
  const original=structuredClone(f.task.mr!.config),run=f.hooks.run,updates:string[]=[];
  const flag=role==='reviewers'?'--approval-reviewers':role==='approvers'?'--approval-approvers':'--assignees';
  f.hooks.run=async(t,args,label,required)=>{
   if(args.includes(flag)){
    const people=args[args.indexOf(flag)+1]!;updates.push(people);
    if(people.includes('x00660165'))throw Error(role==='assignees'?assigneeRejection:`HTTP 400: The approval ${role} must be in the authorized user list. Please check the following users: x00660165 (CH.00201400)`);
    const members=people.split(',').map(username=>({username,approved:false}));
    if(role==='reviewers')f.view.approval_merge_request_reviewers=members;
    else if(role==='approvers')f.view.approval_merge_request_approvers=members;
    else f.view.merge_request_assignee_list=members;
    return {exitCode:0,output:'{}'};
   }
   return run(t,args,label,required);
  };
  await f.workflow.setup(f.task);
  assert.deepEqual(updates,['x00660165,l00831259','l00831259']);assert.deepEqual(f.task.mr!.config,original);
  assert.deepEqual(f.task.mr!.rejectedRoles,{[role]:['x00660165']});assert.equal(f.task.mr!.phase,'PIPELINE');
  const restored=structuredClone(f.task);restored.mr!.setup[role]=false;await new MrWorkflow(f.hooks).setup(restored);assert.equal(updates.length,2);
 }
});
test('assignee rejection does not alter other roles or infer unauthorized accounts',()=>{
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection,'assignees',['x00660165','l00831259']),['x00660165']);
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection,'approvers',['x00660165']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection,'reviewers',['x00660165']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection,'assignees',['x006601650']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection.replace('HTTP 400','HTTP 403'),'assignees',['x00660165']),[]);
 assert.deepEqual(rejectedAuthorizedPeople(assigneeRejection.replace('CH.00201400','CH.UNKNOWN'),'assignees',['x00660165']),[]);
});
test('all invalid assignees stop rather than clear the role or change protection settings',async()=>{
 const f=fixture();f.task.mr!.config.roles.assignees=['x00660165'];const run=f.hooks.run;let writes=0;
 f.hooks.run=async(t,args,label,required)=>{if(args.includes('--assignees')){writes++;throw Error(assigneeRejection);}return run(t,args,label,required);};
 await assert.rejects(f.workflow.setup(f.task),/均不在授权名单/);await assert.rejects(f.workflow.setup(f.task),/均不在授权名单/);
 assert.equal(writes,1);assert.deepEqual(f.task.mr!.config.roles.assignees,['x00660165']);
});

test('owner role notifications use MCP while others and a separate contact use CLI',async()=>{
 const f=fixture();f.view.approval_merge_request_reviewers=[{username:'owner1',approved:false},{username:'r123',approved:false}];
 await f.workflow.tick(f.task,now);
 assert.ok(f.calls.some(c=>c[0]==='welink-mcp'&&c.includes('owner1')));assert.ok(f.calls.some(c=>c[0]==='welink-cli'&&c.includes('r123')));assert.ok(!f.calls.some(c=>c[0]==='welink-cli'&&c.includes('owner1')));
 f.task.mr!.config.contact='contact1';await f.workflow.tick(f.task,now+120*60000);await f.workflow.tick(f.task,now+240*60000);
 assert.equal(f.calls.filter(c=>c[0]==='welink-mcp').length,3);assert.equal(f.calls.filter(c=>c[0]==='welink-cli'&&c.includes('contact1')).length,1);
});
test('failed owner MCP escalation remains uncertain and never falls back to self CLI',async()=>{
 const f=fixture();let sends=0;f.hooks.notifySelf=async()=>{sends++;throw Error('MCP 结果待确认');};
 for(const minutes of [0,120,240,360])await f.workflow.tick(f.task,now+minutes*60000);
 assert.equal(sends,2);assert.ok(Object.values(f.task.mr!.notifications).some(n=>n.pending));assert.ok(!f.calls.some(c=>c[0]==='welink-cli'&&c.includes('owner1')));
});

test('CLI notification text remains one complete single-line argument',async()=>{
 const f=fixture();await f.workflow.tick(f.task,now);
 const args=f.calls.find(c=>c[0]==='welink-cli')!;
 assert.equal(args.length,7);assert.equal(args[5],'--text');
 assert.equal(args[6],`UT 治理 MR 请检视。；仓库：Demo；MR：${f.task.pullRequestUrl}`);
});
test('explicit expired authentication logs in once and counts only the successful delivery',async()=>{
 const f=fixture(),run=f.hooks.run;let sends=0,logins=0;
 f.hooks.loginWelink=async()=>{logins++;return true;};
 f.hooks.run=async(t,args,label,required)=>args[0]==='welink-cli'&&++sends===1?{exitCode:1,output:'HTTP 401: token expired'}:run(t,args,label,required);
 await f.workflow.tick(f.task,now);await f.workflow.tick(f.task,now+60000);
 assert.equal(logins,1);assert.equal(sends,2);
 const entry=Object.values(f.task.mr!.notifications)[0]!;assert.equal(entry.count,1);assert.equal(entry.pending,false);
});
test('uncertain CLI failures never trigger login or automatic redelivery',async()=>{
 for(const result of [{exitCode:124,output:'token expired'},{exitCode:1,output:'network timeout'},{exitCode:1,output:'HTTP 403: forbidden'},{exitCode:0,output:'unknown response'}]){
  const f=fixture(),run=f.hooks.run;let sends=0,logins=0;
  f.hooks.loginWelink=async()=>{logins++;return true;};
  f.hooks.run=async(t,args,label,required)=>{if(args[0]==='welink-cli'){sends++;return result;}return run(t,args,label,required);};
  await f.workflow.tick(f.task,now);await f.workflow.tick(f.task,now+60000);
  assert.equal(logins,0);assert.equal(sends,1);assert.ok(Object.values(f.task.mr!.notifications).some(n=>n.pending));
 }
});
test('failed login or continued rejection pauses without a login loop',async()=>{
 for(const mode of ['false','throws','still-expired']){
  const f=fixture(),run=f.hooks.run;let sends=0,logins=0;
  f.hooks.loginWelink=async()=>{logins++;if(mode==='throws')throw Error('login failed');return mode==='still-expired';};
  f.hooks.run=async(t,args,label,required)=>{if(args[0]==='welink-cli'){sends++;return {exitCode:1,output:'请先登录'};}return run(t,args,label,required);};
  await f.workflow.tick(f.task,now);await f.workflow.tick(f.task,now+60000);
  assert.equal(logins,1);assert.equal(sends,mode==='still-expired'?2:1);assert.equal(f.task.mr!.paused,true);
  assert.match(f.task.mr!.error,/welink-cli auth login/);
  const entry=Object.values(f.task.mr!.notifications)[0]!;assert.equal(entry.count,0);assert.equal(entry.pending,false);
 }
});

function rebuildFixture(){
 const f=fixture(),run=f.hooks.run;let rebuilds=0;f.task.mr!.pipelineId='10';
 f.pipeline.status='failed';f.gate.ci_state_passed=false;
 f.hooks.run=async(t,args,label,required)=>{
  if(args[1]==='pipeline'&&args[2]==='failure')return {exitCode:0,output:JSON.stringify({failures:[{metrics:[{field_url:'?indicatorType=build2.0_build',exceeded:true}]}]})};
  if(args[1]==='pipeline'&&args[2]==='rebuild-failed'){rebuilds++;assert.ok(!args.includes('--columns'));return {exitCode:0,output:'accepted'};}
  return run(t,args,label,required);
 };
 return {...f,rebuilds:()=>rebuilds};
}
test('构建重跑等待实际状态变化，不因旧 failed 重复触发，最多三次',async()=>{
 const f=rebuildFixture();f.task.mr!.rounds=f.task.mr!.config.maxRepairRounds;
 for(let i=0;i<3;i++){
  await f.workflow.tick(f.task,now+i*10000);assert.equal(f.rebuilds(),i+1);
  await f.workflow.tick(f.task,now+i*10000+1000);assert.equal(f.rebuilds(),i+1);
  f.pipeline.status='running';await f.workflow.tick(f.task,now+i*10000+2000);
  f.pipeline.status='failed';
 }
 await f.workflow.tick(f.task,now+40000);assert.equal(f.rebuilds(),3);assert.equal(f.task.mr!.paused,true);assert.equal(f.repairs(),0);
});
test('未确认重跑跨重启只查询，人工点击不能重复提交',async()=>{
 const f=rebuildFixture();await f.workflow.tick(f.task,now);
 const restored=structuredClone(f.task),workflow=new MrWorkflow(f.hooks);
 await workflow.tick(restored,now+1000);assert.equal(f.rebuilds(),1);
 await assert.rejects(workflow.rerunPipeline(restored),/未确认/);assert.equal(f.rebuilds(),1);
});
test('人工重跑不能运行过时提交或正在运行的流水线',async()=>{
 const f=rebuildFixture();f.view.sha='changed';await assert.rejects(f.workflow.rerunPipeline(f.task),/提交已变化/);
 f.view.sha='sha1';f.pipeline.status='running';await assert.rejects(f.workflow.rerunPipeline(f.task),/最新的失败/);assert.equal(f.rebuilds(),0);
});
test('人工重跑一次不刷新自动额度，后续失败不自动重跑',async()=>{
 const f=rebuildFixture();f.task.mr!.pipelineId='10';f.task.mr!.rebuild={sha:'sha1',attempts:3};
 await f.workflow.rerunPipeline(f.task);assert.equal(f.rebuilds(),1);assert.equal(f.task.mr!.rebuild.attempts,3);
 f.pipeline.status='running';await f.workflow.tick(f.task,now);f.pipeline.status='failed';await f.workflow.tick(f.task,now+1000);
 assert.equal(f.rebuilds(),1);assert.equal(f.task.mr!.paused,true);
});
test('重跑请求响应丢失只确认远端，新提交使用独立额度',async()=>{
 const f=rebuildFixture(),run=f.hooks.run;
 f.hooks.run=async(t,args,label,required)=>{const result=await run(t,args,label,required);if(args[2]==='rebuild-failed')throw Error('response lost');return result;};
 await f.workflow.tick(f.task,now);assert.equal(f.task.mr!.writePending,'pipeline-rebuild');
 await f.workflow.tick(f.task,now+1000);assert.equal(f.rebuilds(),1);
 f.view.sha='sha2';await f.workflow.tick(f.task,now+2000);assert.equal(f.task.mr!.rebuild?.attempts,0);assert.equal(f.task.mr!.writePending,undefined);
});

test('WeLink CLI 正文为一个参数且 Markdown 链接转为纯 URL',async()=>{
 const f=fixture();const url=f.task.pullRequestUrl;f.task.pullRequestUrl='['+url+']('+url+')';
 await f.workflow.tick(f.task,now);
 const sent=f.calls.find(c=>c[0]==='welink-cli');assert.ok(sent);
 assert.equal(sent.length,7);const text=sent[6]!;
 assert.ok(text.includes(url));assert.ok(!text.includes(']('));assert.ok(!/[\r\n]/.test(text));assert.ok(!text.startsWith('"'));
});

test('待检视进展通过 MCP 发给用户且轮询重启不重复，终态另发一次',async()=>{
 const f=fixture();await f.workflow.tick(f.task,now);assert.equal(f.progress.length,1);assert.match(f.progress[0]!,/已通知检视人：r123/);
 const restored=structuredClone(f.task),workflow=new MrWorkflow(f.hooks);await workflow.tick(restored,now+1000);assert.equal(f.progress.length,1);
 f.view.state='merged';await workflow.tick(restored,now+2000);await workflow.checkTerminal(restored);
 assert.equal(f.progress.length,2);assert.match(f.progress[1]!,/已合入/);
});
test('用户 MCP 失败独立记录且不阻断修复、终态与去重',async()=>{
 const f=fixture();let sends=0;f.hooks.notifySelf=async()=>{sends++;throw Error('MCP timeout');};
 await f.workflow.tick(f.task,now);assert.equal(f.task.mr!.paused,false);assert.equal(f.task.status,'MR_PENDING');
 await f.workflow.tick(f.task,now+1000);assert.equal(sends,1);
 assert.ok(Object.values(f.task.mr!.notifications).some(n=>n.pending&&n.error==='MCP timeout'));
 f.view.state='closed';await f.workflow.tick(f.task,now+2000);assert.equal(f.task.status,'MR_CLOSED');assert.equal(sends,2);
});
test('检视通知失败时用户进展不能报告已通知',async()=>{
 const f=fixture();f.setFailSend();await f.workflow.tick(f.task,now);
 assert.equal(f.progress.length,1);assert.match(f.progress[0]!,/检视通知失败或结果未确认/);assert.doesNotMatch(f.progress[0]!,/已通知检视人/);
});
test('无 MR 的任务失败也用 MCP，重复事件不重复发送',async()=>{
 const f=fixture();f.task.mr!.iid='';f.task.pullRequestUrl='';
 await f.workflow.notifyProgress(f.task,'task:BASELINE:0','基线执行失败，需要人工介入。');
 await f.workflow.notifyProgress(f.task,'task:BASELINE:0','基线执行失败，需要人工介入。');
 const sent=f.calls.filter(c=>c[0]==='welink-mcp');assert.equal(sent.length,1);assert.ok(sent[0]!.includes('owner1'));
});
