import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {DtsTickets,ticketFields} from '../src/modules/autout/dts.js';

const product={rNo:'1',cNo:'2',bNo:'3'};
function testStore(){const store=new TaskStore(':memory:');store.putRecord('auto-ut-report-config','main',{config:{versions:[{version:'R27C10',dtsProduct:product},{version:'R27C00',dtsProduct:{rNo:'1',cNo:'4',bNo:'5'}}]}});return store;}
function pbiReply(params:Record<string,unknown>){const name=String((params.arguments as Record<string,unknown>).arg0);const c00=name.includes('C00');return reply([{pbiName:name,pbiId:name.endsWith('B001')?(c00?'5':'3'):name.includes('C')?(c00?'4':'2'):'1',parentId:name.endsWith('B001')?(c00?'4':'2'):name.includes('C')?'1':'0'}]);}
const reply=(result:unknown)=>({content:[{type:'text',text:JSON.stringify({status:'success',result})}]});
test('DTS 使用固定标题，建单流转确认后回填，重复请求不重复建单',async()=>{
 const store=testStore();const names:string[]=[];
 const service=new DtsTickets(store,async()=>async(method,params)=>{if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);names.push(String(params.name));return reply(params.name==='createTicket'?'DTS2609220015806':params.name==='batchQueryTicket'?{datas:[{dtsBizNo:'DTS2609220015806',dtsStatus:'DTS009',currentHandler:'w00789509'}]}:{});},async()=>{});
 try{const result=await service.create('request1','w00789509','R27C10');assert.equal(result.status,'READY');assert.equal(result.ticket,'DTS2609220015806');await service.create('request1','w00789509','R27C10');assert.deepEqual(names,['createTicket','executeTicket','batchQueryTicket']);assert.equal(ticketFields(true,'tester','R27C10',product).find(x=>x.fieldId==='sBriefDescription')?.value,'【代码检视】UT治理');assert.equal(ticketFields(true,'tester','R27C10',product).find(x=>x.fieldId==='sHandlers')?.value,'tester');}finally{store.close();}
});
test('草稿建单后流转失败仍保存单号，新请求和重启都不重复建单',async()=>{
 const store=testStore();let creates=0;
 const connect=async()=>async(method:string,params:Record<string,unknown>)=>{if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);if(params.name==='createTicket'){creates++;return reply('DTS123');}throw Error('network');};
 try{const service=new DtsTickets(store,connect);const result=await service.create('request1','tester','R27C10');assert.equal(result.status,'REVIEW');assert.equal(result.ticket,'DTS123');const restarted=new DtsTickets(store,connect);assert.equal((await restarted.create('request2','tester','R27C10')).ticket,'DTS123');assert.equal(creates,1);}finally{store.close();}
});
test('创建请求超时不自动重试，凭据缺失可重新准备',async()=>{
 const store=testStore();let requests=0;
 try{const service=new DtsTickets(store,async()=>async(method,params)=>{if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);requests++;throw Error('timeout');});assert.equal((await service.create('a','tester','R27C10')).status,'REVIEW');await service.create('b','tester','R27C10');assert.equal(requests,1);
 const failed=new DtsTickets(store,async()=>{throw Error('缺少登录凭据');});assert.match((await failed.create('c','other','R27C10')).message,/凭据/);assert.equal(store.getRecord('dts-ticket','c'),undefined);
 }finally{store.close();}
});

test('流转后等待并轮询，只提交一次流转，核对节点和处理人',async()=>{
 const store=testStore(),names:string[]=[],waits:number[]=[];let reads=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);names.push(String(params.name));
  if(params.name==='createTicket')return reply('DTS123');
  if(params.name==='executeTicket'){const fields=params.arguments as Record<string,unknown>;assert.equal(fields.arg0,'DTS123');return reply({});}
  reads++;return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:reads===1?'DTS001':'DTS009',dtsStatusName:reads===1?'草稿':'开发人员实施修改',currentHandler:'tester'}]});
 },async ms=>{waits.push(ms);});
 try{const result=await service.create('one','tester','R27C10');assert.equal(result.status,'READY');assert.equal(result.currentHandler,'tester');assert.deepEqual(waits,[2000,2000]);assert.equal(names.filter(n=>n==='executeTicket').length,1);}finally{store.close();}
});
test('流转错误保留原因，刷新原单不写入，手动继续只流转草稿',async()=>{
 const store=testStore();let node='DTS001',creates=0,executes=0,fail=true;
 const connect=async()=>async(method:string,params:Record<string,unknown>)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  if(params.name==='createTicket'){creates++;return reply('DTS123');}
  if(params.name==='executeTicket'){executes++;if(fail)return {content:[{type:'text',text:JSON.stringify({status:'error',error:'无效的产品信息路径 token=secret'})}]};node='DTS009';return reply({});}
  return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:node,currentHandler:'tester'}]});
 };
 try{let service=new DtsTickets(store,connect,async()=>{});const result=await service.create('one','tester','R27C10');assert.match(result.message,/executeTicket.*无效的产品信息路径/);assert.doesNotMatch(result.message,/secret/);
 service=new DtsTickets(store,connect,async()=>{});await service.control('DTS123','tester','check','R27C10');assert.equal(executes,1);
 fail=false;assert.equal((await service.control('DTS123','tester','continue','R27C10')).status,'READY');assert.equal(executes,2);assert.equal(creates,1);
 await service.control('DTS123','tester','continue','R27C10');assert.equal(executes,2);
 }finally{store.close();}
});
test('非草稿或处理人不匹配不推进，确认超时可只刷新恢复',async()=>{
 const store=testStore();let node='DTS001',handler='other',executes=0,reads=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  if(params.name==='createTicket')return reply('DTS123');
  if(params.name==='executeTicket'){executes++;return reply({});}
  reads++;return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:node,currentHandler:handler}]});
 },async()=>{});
 try{assert.equal((await service.create('one','tester','R27C10')).status,'REVIEW');assert.equal(reads,3);assert.equal(executes,1);
 node='DTS009';assert.equal((await service.control('DTS123','tester','continue','R27C10')).status,'REVIEW');assert.equal(executes,1);
 handler='tester';assert.equal((await service.control('DTS123','tester','check','R27C10')).status,'READY');assert.equal(executes,1);
 await assert.rejects(service.control('DTS123','another','continue','R27C10'),/未找到/);
 }finally{store.close();}
});
test('并发继续不会重复流转，未知写入结果只允许状态读取',async()=>{
 const store=testStore();let executes=0,release:()=>void=()=>{};
 store.putRecord('dts-ticket','one',{requestId:'one',username:'tester',ticket:'DTS123',status:'REVIEW',message:''});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  if(params.name==='batchQueryTicket')return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:'DTS001',currentHandler:'tester'}]});
  executes++;await blocked;throw Error('network timeout');
 },async()=>{});
 try{const first=service.control('DTS123','tester','continue','R27C10');await assert.rejects(service.control('DTS123','tester','continue','R27C10'),/正在建单或流转/);release();assert.equal((await first).status,'REVIEW');assert.equal(executes,1);await service.create('one','tester','R27C10');assert.equal(executes,1);}finally{store.close();}
});

test('流转响应丢失后只查询原单，已到指定开发人员则恢复成功',async()=>{
 const store=testStore();const names:string[]=[];
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);names.push(String(params.name));
  if(params.name==='createTicket')return reply('DTS123');
  if(params.name==='executeTicket')throw Error('response timeout');
  return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:'DTS009',currentHandler:'tester'}]});
 },async()=>{});
 try{assert.equal((await service.create('one','tester','R27C10')).status,'READY');assert.deepEqual(names,['createTicket','executeTicket','batchQueryTicket']);}finally{store.close();}
});
test('确认查询暂时失败仍继续只读核对，不重复建单流转',async()=>{
 const store=testStore();let reads=0,creates=0,executes=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  if(params.name==='createTicket'){creates++;return reply('DTS123');}
  if(params.name==='executeTicket'){executes++;return reply({});}
  if(++reads===1)throw Error('temporary read failure');
  if(reads===2)return reply({datas:[]});
  return reply({datas:[{dtsBizNo:'DTS123',dtsStatus:'DTS009',currentHandler:'tester'}]});
 },async()=>{});
 try{assert.equal((await service.create('one','tester','R27C10')).status,'READY');assert.equal(reads,3);assert.equal(creates,1);assert.equal(executes,1);}finally{store.close();}
});
test('流转与确认均失败保留两个原因和原单号，达到次数上限即停止',async()=>{
 const store=testStore();let reads=0,executes=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  if(params.name==='createTicket')return reply('DTS123');
  if(params.name==='executeTicket'){executes++;throw Error('transition response timeout');}
  reads++;throw Error('query unavailable');
 },async()=>{});
 try{const result=await service.create('one','tester','R27C10');assert.equal(result.status,'REVIEW');assert.equal(result.ticket,'DTS123');assert.match(result.message,/transition response timeout.*query unavailable/);assert.equal(reads,3);assert.equal(executes,1);}finally{store.close();}
});

test('不同版本分别建单，草稿和流转均提交该版本 B001 的名称和 ID',async()=>{
 const store=testStore(),seen:{name:string;args:Record<string,unknown>}[]=[];let creates=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{
  if(method==='initialize')return{};if(params.name==='queryPbiLikeName')return pbiReply(params);
  const args=params.arguments as Record<string,unknown>;seen.push({name:String(params.name),args});
  if(params.name==='createTicket')return reply('DTS'+ ++creates);
  if(params.name==='executeTicket')throw Error('keep draft');
  return reply({datas:[{dtsBizNo:(args.arg0 as string[])[0],dtsStatus:'DTS001',currentHandler:'tester'}]});
 },async()=>{});
 try{
  const first=await service.create('a','tester','R27C10'),second=await service.create('b','tester','R27C00');
  assert.notEqual(first.ticket,second.ticket);assert.equal(creates,2);
  assert.equal((await service.create('c','tester','R27C10')).ticket,first.ticket);assert.equal(creates,2);
  await assert.rejects(service.create('a','tester','R27C00'),/不匹配/);
  await assert.rejects(service.control(first.ticket,'tester','continue','R27C00'),/未找到/);
  const writes=seen.filter(v=>v.name==='createTicket'||v.name==='executeTicket');assert.equal(writes.length,4);
  for(const [i,w] of writes.entries()){
   const fields=w.args.arg3 as {fieldId:string;value:unknown}[];
   const prod=fields.find(f=>f.fieldId==='prodInfo')!.value as {key:string;value:string;valueName:string}[];
   assert.deepEqual(prod.find(f=>f.key==='sProdBNo'),{key:'sProdBNo',value:i<2?'3':'5',valueName:i<2?'MAE-NEM V100R027C10B001':'MAE-NEM V100R027C00B001'});
  }
 }finally{store.close();}
});
test('查询不到目标版本时禁止远端建单，可修复后重新查询',async()=>{
 const store=new TaskStore(':memory:');let creates=0,queries=0;
 const service=new DtsTickets(store,async()=>async(method,params)=>{if(method==='initialize')return{};if(params.name==='queryPbiLikeName'){queries++;return reply([]);}creates++;throw Error('must not create');});
 try{const result=await service.create('a','tester','R28C10');assert.match(result.message,/V100R028C10B001/);assert.equal(creates,0);assert.equal(queries,1);assert.equal(store.records('dts-ticket').length,0);}finally{store.close();}
});
