import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import ExcelJS from 'exceljs';
import {Readable} from 'node:stream';
import {ZodError} from 'zod';
import {TaskStore} from '../src/platform/store.js';
import {builtins,ToolsService,toolsRoutes} from '../src/modules/tools/tools.js';
import {parseFrame,validateFields} from '../src/modules/tools/parser.js';
const base=[{name:'cmdCode',type:'hex',offset:4},{name:'Handle',type:'hex',offset:4}];
const custom={code:'abcd',name:'测试命令',fields:[...base,{name:'value',type:'int',offset:4,label:'测试值',unit:'W',enum:{'5':'正常'},invalidValue:65535,desc:'业务说明'}]};

test('all nine supplied frames parse with real values, TLV metadata, arrays and topology',()=>{
 assert.equal(builtins.length,9);
 const counts=[4,4,48,3,3,4,4,34,9];
 for(const [i,c]of builtins.entries()){
  const r=parseFrame(c.code,c.fields,c.sample.toUpperCase().replace(/(.{8})/g,'$1 \n'));
  assert.equal(r.code,c.code);assert.equal(r.matched,true);assert.equal(r.fields.length,counts[i],c.code);assert.equal(r.fields[0]?.value,c.code);
  assert.deepEqual(r.warnings,[]);
  assert.throws(()=>parseFrame(c.code,c.fields,c.sample.slice(0,-2)),c.code+' truncated');
 }
 const power=builtins.find(c=>c.code==='0b17')!;const r=parseFrame(power.code,power.fields,power.sample);
 assert.equal(r.fields.find(f=>f.path==='powerSupplyInfo.lithiumBatteryRemainingCapacity')?.value,285);assert.equal(r.fields.find(f=>f.path==='powerSupplyInfo.xmuPmuTotalPower')?.value,5129);assert.equal(r.fields.find(f=>f.path==='powerSupplyInfo.leadAcidBatteryRemainingCapacity')?.invalid,true);
 assert.ok(r.fields.some(f=>f.path.includes('[0]')));assert.ok(r.fields.some(f=>f.unit));assert.ok(r.fields.some(f=>f.meaning));
 const topo=builtins.find(c=>c.code==='2d63')!;const t=parseFrame(topo.code,topo.fields,topo.sample);assert.ok(t.fields.some(f=>f.path.startsWith('NodeInfo[0]')));assert.ok(t.fields.some(f=>f.path.startsWith('LineInfo[0]')));
});
test('feature filter is optional and does not discard commands without a feature',()=>{
 for(const c of builtins){const r=parseFrame(c.code,c.fields,c.sample,999);assert.equal(r.matched,r.feature===null,c.code);}
 const c=builtins[0]!;assert.equal(parseFrame(c.code,c.fields,c.sample,3).matched,true);
});
test('configuration validation rejects malformed types, prototype keys, cycles, missing references and ambiguous tags',()=>{
 for(const fields of [[],[...base,{name:'x',type:'execute',offset:4}],[...base,{name:'__proto__',type:'int',offset:4}],[...base,{name:'x',type:'int',offset:3}],[...base,{name:'x',type:'array',lengthKey:'@missing',children:base}],[...base,{name:'Handle',type:'int',offset:4}]])assert.throws(()=>validateFields(fields,'abcd'));
 const cyclic:unknown[]=[];cyclic.push(cyclic);assert.throws(()=>validateFields(cyclic,'abcd'));
 const nest={name:'x',type:'nest',offset:4,tag:'0001',children:base};assert.throws(()=>validateFields([...base,nest,{...nest,name:'y'}],'abcd'));
});
test('parser handles unknown tags, repeated arrays, large integers and malformed boundaries',()=>{
 const fields=validateFields([...base,{name:'large',type:'long',offset:16}],'abcd');
 assert.equal(parseFrame('abcd',fields,'abcd0000ffffffffffffffff').fields.at(-1)?.value,'18446744073709551615');
 for(const hex of ['abcd000','abcd0000gg','beef0000','abcd0000','abcd0000000000000000000000'])assert.throws(()=>parseFrame('abcd',fields,hex));
 const nest={name:'info',type:'nest',offset:4,tag:'0001',children:[{name:'value',type:'int',offset:4}]};
 const tlv=validateFields([...base,nest],'abcd');
 assert.match(parseFrame('abcd',tlv,'abcd0000ffff00020005').warnings[0]??'',/未知 tag/);
 assert.throws(()=>parseFrame('abcd',tlv,'abcd0000000100050001'));
 assert.throws(()=>parseFrame('abcd',tlv,'abcd0000000100020005000100020006'));
 const repeated=validateFields([...base,{...nest,supportArray:true}],'abcd');
 const parsed=parseFrame('abcd',repeated,'abcd0000000100020005000100020006');assert.deepEqual(parsed.fields.slice(2).map(f=>f.value),[5,6]);
 const arr=validateFields([...base,{name:'@count',type:'int',offset:4},{name:'items',type:'array',lengthKey:'@count',children:[{name:'value',type:'int',offset:4}]}],'abcd');
 assert.throws(()=>parseFrame('abcd',arr,'abcd0000ffff'));assert.throws(()=>parseFrame('abcd',arr,'abcd000000020001'));
});
test('custom registration persists in SQLite; conflict checks and restoring builtins are explicit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-tools-')),file=join(dir,'db.sqlite');let store=new TaskStore(file);
 try{let s=new ToolsService(store);assert.equal(s.validate(custom).conflict,null);const first=s.save({definition:custom});assert.throws(()=>s.save({definition:custom}),{statusCode:409});store.close();store=new TaskStore(file);s=new ToolsService(store);assert.equal(s.get('abcd').revision,first.revision);
  const updated=s.save({definition:{...custom,name:'更新名称'},expectedRevision:first.revision});assert.throws(()=>s.remove('abcd',{revision:first.revision}),{statusCode:409});s.remove('abcd',{revision:updated.revision});assert.throws(()=>s.get('abcd'),{statusCode:404});
  const builtin=builtins[0]!;const override=s.save({definition:{code:builtin.code,name:'替换',fields:builtin.fields},expectedRevision:builtin.revision});s.remove(builtin.code,{revision:override.revision});assert.equal(s.get(builtin.code).builtin,true);assert.throws(()=>s.remove(builtin.code,{revision:builtin.revision}));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('batch preserves physical lines and distinguishes errors from filtering; Excel contains typed literal cells',async()=>{
 const store=new TaskStore(':memory:'),s=new ToolsService(store),app=Fastify();toolsRoutes(app,s);
 app.setErrorHandler((e,_req,reply)=>reply.code(e instanceof ZodError?400:e instanceof Error&&'statusCode'in e&&typeof e.statusCode==='number'?e.statusCode:500).send({message:e instanceof Error?e.message:''}));
 try{
  assert.equal((await app.inject({method:'POST',url:'/api/tools/binlog/commands',payload:{definition:custom}})).statusCode,201);
  const input={code:'abcd',batch:true,text:'# comment\n\nabcd00000005\ninvalid\nabcd0000ffff'};
  const parsed=s.parse(input);assert.deepEqual(parsed.records.map(r=>r.line),[3,4,5]);assert.deepEqual(parsed.summary,{total:3,success:2,errors:1,filtered:0});assert.equal(parsed.records[2]?.result?.fields.at(-1)?.invalid,true);
  assert.throws(()=>s.parse({...input,text:'abcd00000005\n'.repeat(501)}));
  const response=await app.inject({method:'POST',url:'/api/tools/binlog/export',payload:input});assert.equal(response.statusCode,200);assert.match(response.headers['content-type']??'',/spreadsheetml/);
  const book=new ExcelJS.Workbook();await book.xlsx.read(Readable.from([response.rawPayload]));assert.equal(book.worksheets[0]?.getCell('G4').value,5);
  assert.equal((await app.inject({method:'POST',url:'/api/tools/binlog/export',payload:{...input,revision:'stale'}})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/tools/binlog/commands/validate',payload:{...custom,fields:[{type:'exec'}]}})).statusCode,400);
 }finally{await app.close();store.close();}
});
