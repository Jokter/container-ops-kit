import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {TaskStore} from '../src/platform/store.js';
import {GroupMrService,type Entry} from '../src/modules/automation/group-mr.js';
import {reviewThreads,reviewFiles,addedLines,supportsReviewCommand} from '../src/modules/automation/group-mr-workbench.js';
const sha='a'.repeat(40),other='b'.repeat(40),diff='@@ -1,2 +1,3 @@\n old\n+new\n tail';
const help=(kind:string)=>`Usage: codehub-cli mr review ${kind} <iid>${kind==='reply'?' <discussion-id>':''} [options]\nOptions:\n  -p, --project <project>\n  --body <body>\n  --path <path>\n  --line <line>`;
function fixture(mode='ok'){
 const store=new TaskStore(':memory:');let resolved=false,reply='',extra=false,head=sha,views=0;
 const writes:string[][]=[];
 const notes=()=>[{id:'thread',resolved,notes:[{id:'1',body:'Please fix',resolvable:true,author:{username:'reviewer'},position:{new_path:'src/a.ts',new_line:2,head_sha:sha}},...(reply?[{id:'2',body:reply,author:{username:'owner'}}]:[]),...(extra?[{id:'3',body:'changed concurrently',author:{username:'developer'}}]:[])]}];
 const service=new GroupMrService(store,async args=>{
  let value:unknown={};
  if(args.includes('--help'))return {exitCode:0,output:mode==='unsupported'?'unknown command':help(args[3]!)};
  if(args[2]==='view'){views++;value={iid:1,state:mode==='closed'?'closed':'opened',sha:mode==='changed-read'&&views>1?other:head};}
  else if(args[2]==='changes')value={changes:[{new_path:'src/a.ts',old_path:'src/a.ts',diff}]};
  else if(args[3]==='list')value=notes();
  else if(args[2]==='review'){
   writes.push([...args]);
   if(mode==='denied')return {exitCode:1,output:'HTTP 403 Forbidden'};
   if(mode==='timeout')return {exitCode:124,output:'timeout'};
   if(args[3]==='resolve')resolved=true;
   else reply=args[args.indexOf('--body')+1]!;
   if(mode==='accepted-timeout')return {exitCode:124,output:'timeout'};
  }else throw Error('Unexpected command: '+args.slice(0,4).join(' '));
  return {exitCode:0,output:JSON.stringify(value)};
 });
 const e:Entry={id:randomUUID(),repo:'MAE-M/Access/Demo',iid:'1',url:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/1',sha,previousSha:'',messageId:'1',sender:'developer',shortcut:false,phase:'ISSUES',status:'待修改',detail:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),writePending:'',events:[]};
 store.putRecord('group-mr-entry',e.id,e);
 return {service,store,e,writes,notes,setHead:()=>{head=other;},changeThread:()=>{extra=true;},shutdown:async()=>{await service.close();store.close();}};
}
test('workbench parsers preserve threads/positions, reject incomplete data, and map only added lines',()=>{
 const f=fixture();try{const threads=reviewThreads(JSON.stringify(f.notes()));assert.equal(threads[0]!.line,2);assert.equal(threads[0]!.notes[0]!.author,'reviewer');assert.equal(threads[0]!.resolvable,true);assert.equal(threads[0]!.fingerprint.length,64);
 assert.deepEqual([...addedLines(diff)],[2]);assert.equal(reviewFiles(JSON.stringify({changes:[{new_path:'x',binary:true}]}))[0]!.unavailable,true);
 for(const output of ['null','{}','{"data":[],"has_more":true}','{"data":[],"total":2}','{"data":[{"id":"1"}]}'])assert.throws(()=>reviewThreads(output));
 assert.equal(supportsReviewCommand(help('reply'),'reply'),true);assert.equal(supportsReviewCommand(help('create'),'create'),true);assert.equal(supportsReviewCommand('reply exists; try --body','reply'),false);
 }finally{void f.shutdown();}
});
test('workspace reads actual diff and complete discussions, checks head twice, and never writes',async()=>{
 const f=fixture();try{const result=await f.service.reviewWorkspace(f.e.id);assert.equal(result?.sha,sha);assert.equal(result?.files[0]!.path,'src/a.ts');assert.equal(result?.threads.length,1);assert.equal(result?.capabilities.reply,true);assert.equal(f.writes.length,0);}finally{await f.shutdown();}
 const changed=fixture('changed-read');try{await assert.rejects(changed.service.reviewWorkspace(changed.e.id),/提交或状态已变化/);}finally{await changed.shutdown();}
});
for(const action of ['resolve','reply','create'] as const)test('manual '+action+' uses one write and confirms remotely without merging',async()=>{
 const f=fixture();try{const fingerprint=reviewThreads(JSON.stringify(f.notes()))[0]!.fingerprint;
 const data=action==='create'?{action,sha,operationId:randomUUID(),path:'src/a.ts',line:2,body:'Check this'}:action==='reply'?{action,sha,operationId:randomUUID(),discussionId:'thread',fingerprint,body:'Fixed now'}:{action,sha,operationId:randomUUID(),discussionId:'thread',fingerprint,confirmed:true,reason:'已核对修复'};
 await f.service.reviewWorkspaceAction(f.e.id,data);await f.service.reviewWorkspaceAction(f.e.id,data);assert.equal(f.writes.length,1);assert.equal(f.writes[0]![3],action);const saved=f.store.getRecord<Entry>('group-mr-entry',f.e.id)!;assert.equal(saved.writePending,'');assert.equal(saved.phase,'ISSUES');assert.equal(saved.manualReviewPending,undefined);assert.ok(saved.events.length>0);
 }finally{await f.shutdown();}
});
for(const mode of ['timeout','accepted-timeout','denied'])test('uncertain '+mode+' is persisted, blocked from replay, and refresh is read-only',async()=>{
 const f=fixture(mode);try{const input={action:'resolve',sha,operationId:randomUUID(),discussionId:'thread',fingerprint:reviewThreads(JSON.stringify(f.notes()))[0]!.fingerprint,confirmed:true,reason:'checked'};
 await assert.rejects(f.service.reviewWorkspaceAction(f.e.id,input));assert.equal(f.writes.length,1);assert.ok(f.store.getRecord<Entry>('group-mr-entry',f.e.id)!.writePending);
 await assert.rejects(f.service.reviewWorkspaceAction(f.e.id,input),/待核对/);const result=await f.service.reviewWorkspace(f.e.id);assert.equal(f.writes.length,1);assert.equal(!!result?.writePending,mode!=='accepted-timeout');
 }finally{await f.shutdown();}
});
for(const mode of ['stale','discussion','closed','hidden','superseded','unconfirmed','invalid-line','unsupported'])test('reject unsafe workbench write before any mutation: '+mode,async()=>{
 const f=fixture(mode);try{const input:Record<string,unknown>={action:'resolve',sha,operationId:randomUUID(),discussionId:'thread',fingerprint:reviewThreads(JSON.stringify(f.notes()))[0]!.fingerprint,confirmed:true,reason:'checked'};
 if(mode==='stale')f.setHead();if(mode==='discussion')f.changeThread();if(mode==='hidden')f.store.putRecord('group-mr-hidden',f.e.id,{id:f.e.id});if(mode==='superseded'){f.e.supersededBy=randomUUID();f.store.putRecord('group-mr-entry',f.e.id,f.e);}if(mode==='unconfirmed')input.confirmed=false;
 const request=mode==='invalid-line'?{action:'create',sha,operationId:randomUUID(),path:'src/a.ts',line:1,body:'test'}:mode==='unsupported'?{action:'reply',sha,operationId:randomUUID(),discussionId:'thread',fingerprint:input.fingerprint,body:'test'}:input;
 await assert.rejects(f.service.reviewWorkspaceAction(f.e.id,request));assert.equal(f.writes.length,0);
 }finally{await f.shutdown();}
});
test('MR reservation rejects a concurrent close',async()=>{
 const f=fixture();try{let finish:()=>void=()=>{};const wait=new Promise<void>(r=>finish=r);f.service['workbenchHead']=async()=>{await wait;return {iid:'1',state:'opened',sha};};
 const input={action:'resolve',sha,operationId:randomUUID(),discussionId:'thread',fingerprint:reviewThreads(JSON.stringify(f.notes()))[0]!.fingerprint,confirmed:true,reason:'checked'};
 const first=f.service.reviewWorkspaceAction(f.e.id,input);await assert.rejects(f.service.reviewWorkspaceAction(f.e.id,input),/执行或排队/);finish();await first;assert.equal(f.writes.length,1);
 }finally{await f.shutdown();}
});
test('CodeHub explicit null stays closed, missing resolvability metadata does not hide review issues',()=>{
 const notes=reviewThreads(JSON.stringify([{id:'closed',resolved:null,notes:[{body:'closed'}]},{id:'open',resolved:false,notes:[{body:'open'}]},{id:'general',resolved:false,notes:[{body:'report',resolvable:false}]}]));
 assert.equal(notes[0]!.resolved,true);assert.equal(notes[1]!.resolved,false);assert.equal(notes[1]!.resolvable,true);assert.equal(notes[2]!.resolvable,false);
});
test('manual pending operation survives service restart and is never replayed',async()=>{
 const f=fixture('timeout');try{const input={action:'resolve',sha,operationId:randomUUID(),discussionId:'thread',fingerprint:reviewThreads(JSON.stringify(f.notes()))[0]!.fingerprint,confirmed:true,reason:'checked'};
 await assert.rejects(f.service.reviewWorkspaceAction(f.e.id,input));await f.service.close();let executed=0;
 const restarted=new GroupMrService(f.store,async()=>{executed++;return {exitCode:0,output:'[]'};});
 try{await assert.rejects(restarted.reviewWorkspaceAction(f.e.id,input),/待核对/);assert.equal(executed,0);assert.ok(f.store.getRecord<Entry>('group-mr-entry',f.e.id)!.manualReviewPending);}finally{await restarted.close();}
 }finally{f.store.close();}
});
