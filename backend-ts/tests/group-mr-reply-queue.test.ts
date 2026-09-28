import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroupMrService,type Entry} from '../src/modules/automation/group-mr.js';
import {TaskStore} from '../src/platform/store.js';
const cfg={enabled:false,groupId:'123456789',authorizedSender:'owner',repositoryPrefix:'MAE-M/',intervalSeconds:10};
function entry(id:string):Entry{return{id,repo:'MAE-M/Demo',iid:id,url:'https://codehub-y.huawei.com/MAE-M/Demo/merge_requests/'+id,sha:'',previousSha:'',messageId:id,sender:'developer',shortcut:false,phase:'PI',status:'',detail:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),writePending:'',events:[]};}
function latch(){let release:()=>void=()=>{};const promise=new Promise<void>(resolve=>release=resolve);return{promise,release};}
for(const fails of [false,true])test('same-group replies serialize and a failed send releases the queue without retry: '+fails,async()=>{
 const store=new TaskStore(':memory:'),started=latch(),held=latch(),texts:string[]=[];let active=0,maxActive=0;
 const service=new GroupMrService(store,async args=>{
  if(args.includes('--help'))return{exitCode:0,output:'--text'};
  texts.push(args[args.indexOf('--text')+1]!);active++;maxActive=Math.max(maxActive,active);
  if(texts.length===1){started.release();await held.promise;}active--;
  return{exitCode:fails&&texts.length===1?1:0,output:fails&&texts.length===1?'send rejected':JSON.stringify({resultCode:0})};
 });
 const a=entry('1681'),b=entry('1680');
 try{
  const first=service['reply'](a,cfg,'检视完成');const outcome=first.then(()=>undefined,error=>error);
  await started.promise;const second=service['reply'](b,cfg,'已收到 MR，正在检视中。');await Promise.resolve();
  assert.equal(texts.length,1);assert.equal(b.reply,undefined);assert.equal(b.writePending,'');
  held.release();await second;assert.equal(!!await outcome,fails);assert.equal(texts.length,2);assert.equal(maxActive,1);
  assert.match(texts[0]!,/1681.*【Agent回复】检视完成/);assert.match(texts[1]!,/1680.*【Agent回复】已收到 MR/);
  assert.equal(a.reply?.status,fails?'unconfirmed':'sent');assert.equal(a.writePending,fails?'群消息回复':'');assert.equal(store.getRecord<Entry>('group-mr-entry',b.id)?.reply?.status,'sent');assert.equal(service['groupReplyTails'].size,0);
 }finally{held.release();await service.close();store.close();}
});
test('different groups do not block each other',async()=>{
 const store=new TaskStore(':memory:'),started=latch(),held=latch();let sends=0;
 const service=new GroupMrService(store,async args=>{if(args.includes('--help'))return{exitCode:0,output:'--text'};sends++;if(args.includes(cfg.groupId)){started.release();await held.promise;}return{exitCode:0,output:'{"resultCode":0}'};});
 try{const first=service['reply'](entry('1'),cfg,'first');await started.promise;await service['reply'](entry('2'),{...cfg,groupId:'987654321'},'second');assert.equal(sends,2);held.release();await first;}
 finally{held.release();await service.close();store.close();}
});
test('shutdown cancels waiting sends without recording them as attempted',async()=>{
 const store=new TaskStore(':memory:'),started=latch(),held=latch();let sends=0;
 const service=new GroupMrService(store,async args=>{if(args.includes('--help'))return{exitCode:0,output:'--text'};sends++;started.release();await held.promise;return{exitCode:0,output:'{"resultCode":0}'};});
 try{const first=service['reply'](entry('1'),cfg,'first');await started.promise;const waiting=entry('2'),second=service['reply'](waiting,cfg,'second');const rejected=assert.rejects(second,/服务正在停止/);await service.close();held.release();await first;await rejected;assert.equal(sends,1);assert.equal(waiting.reply,undefined);assert.equal(waiting.writePending,'');assert.equal(service['groupReplyTails'].size,0);}
 finally{held.release();await service.close();store.close();}
});
