import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/platform/store.js';
import {DtsTickets,ticketFields} from '../src/modules/autout/dts.js';

const reply=(result:unknown)=>({content:[{type:'text',text:JSON.stringify({status:'success',result})}]});
test('DTS 使用固定标题，建单流转确认后回填，重复请求不重复建单',async()=>{
 const store=new TaskStore(':memory:');const names:string[]=[];
 const service=new DtsTickets(store,async()=>async(method,params)=>{if(method==='initialize')return{};names.push(String(params.name));return reply(params.name==='createTicket'?'DTS2609220015806':params.name==='batchQueryTicket'?{datas:[{dtsBizNo:'DTS2609220015806',dtsStatus:'DTS009'}]}:{});});
 try{const result=await service.create('request1','w00789509');assert.equal(result.status,'READY');assert.equal(result.ticket,'DTS2609220015806');await service.create('request1','w00789509');assert.deepEqual(names,['createTicket','executeTicket','batchQueryTicket']);assert.equal(ticketFields(true,'tester').find(x=>x.fieldId==='sBriefDescription')?.value,'【代码检视】UT治理');assert.equal(ticketFields(true,'tester').find(x=>x.fieldId==='sHandlers')?.value,'tester');}finally{store.close();}
});
test('草稿建单后流转失败仍保存单号，新请求和重启都不重复建单',async()=>{
 const store=new TaskStore(':memory:');let creates=0;
 const connect=async()=>async(method:string,params:Record<string,unknown>)=>{if(method==='initialize')return{};if(params.name==='createTicket'){creates++;return reply('DTS123');}throw Error('network');};
 try{const service=new DtsTickets(store,connect);const result=await service.create('request1','tester');assert.equal(result.status,'REVIEW');assert.equal(result.ticket,'DTS123');const restarted=new DtsTickets(store,connect);assert.equal((await restarted.create('request2','tester')).ticket,'DTS123');assert.equal(creates,1);}finally{store.close();}
});
test('创建请求超时不自动重试，凭据缺失可重新准备',async()=>{
 const store=new TaskStore(':memory:');let requests=0;
 try{const service=new DtsTickets(store,async()=>async(method)=>{if(method==='initialize')return{};requests++;throw Error('timeout');});assert.equal((await service.create('a','tester')).status,'REVIEW');await service.create('b','tester');assert.equal(requests,1);
 const failed=new DtsTickets(store,async()=>{throw Error('缺少登录凭据');});assert.match((await failed.create('c','other')).message,/凭据/);assert.equal(store.getRecord('dts-ticket','c'),undefined);
 }finally{store.close();}
});
