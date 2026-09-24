import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {responseDiagnostic} from '../src/modules/automation/group-mr-diagnostics.js';
import {GroupMrService} from '../src/modules/automation/group-mr.js';
import {TaskStore} from '../src/platform/store.js';
import {FileLogs} from '../src/infrastructure/file-logs.js';

test('MR response diagnostics keep nested shapes and statuses without credentials or contents',()=>{
 const value=responseDiagnostic(JSON.stringify({result:{discussions:[{id:17,status:'failed',body:'private comment',author:{username:'private-user'},token:'private-token',diff:'private-code'}]},resultCode:401}));
 const text=JSON.stringify(value);assert.match(text,/discussions/);assert.match(text,/failed/);assert.match(text,/401/);assert.doesNotMatch(text,/private-/);
 assert.equal(responseDiagnostic('<html>private-password</html>').format,'html');assert.doesNotMatch(JSON.stringify(responseDiagnostic('Authorization: Bearer private-token')),/private-token|Bearer/);
});

test('list parse failure writes a dedicated error file with MR context and precise command',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mr-errors-')),store=new TaskStore(':memory:');const service=new GroupMrService(store,async args=>{
  let value:unknown={};if(args[1]==='mr'&&args[2]==='view')value={iid:444,state:'opened',sha:'a'.repeat(40)};
  if(args[1]==='user')value={username:'reviewer'};
  if(args[2]==='review')value={result:{discussions:[{id:1,body:'sensitive-comment',token:'sensitive-token'}]}};
  if(args[2]==='send-to-group')value={resultCode:0};return{exitCode:0,output:JSON.stringify(value)};
 },new FileLogs(root));
 try{
  await service['accept']({id:'1',sender:'other',content:'https://codehub-y.huawei.com/MAE-M/Access/Demo/merge_requests/444',quoteId:''},{enabled:true,groupId:'123456789',authorizedSender:'owner',repositoryPrefix:'MAE-M/Access/',intervalSeconds:5});
  const content=readFileSync(join(root,'automation','group-mr-errors.jsonl'),'utf8');assert.match(content,/codehub-cli mr review list/);assert.match(content,/discussions/);assert.match(content,/列表返回格式/);assert.match(content,/aaaaaaaa/);assert.doesNotMatch(content,/sensitive-/);assert.match(service.list()[0]!.status,/codehub-cli mr review list/);
  const records=content.trim().split('\n').map(line=>JSON.parse(line));const failure=records.find(r=>r.source==='mr-processing');assert.ok(failure);assert.ok(failure.stack.some((frame:string)=>frame.includes('listObjects')));assert.ok(failure.trace.some((event:{diagnostic:{command:string}})=>event.diagnostic.command==='codehub-cli mr view'));assert.equal(failure.diagnostic.attempt,1);assert.equal(failure.diagnostic.timeoutMs,120000);assert.equal(typeof failure.diagnostic.elapsedMs,'number');assert.equal(failure.platform,process.platform);
 }finally{await service.close();store.close();rmSync(root,{recursive:true,force:true});}
});
