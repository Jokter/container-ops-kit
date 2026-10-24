import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from './helpers/studio-harness.mjs';

const definition={code:'abcd',name:'自定义报文',sample:'abcd0001',fields:[{name:'cmdCode',type:'hex',offset:4},{name:'Handle',type:'hex',offset:4}]};
function captureFiles(w,downloads,copied){
  const blobs=new Map();
  w.URL.createObjectURL=blob=>{const url='blob:http://studio.test/file-'+blobs.size;blobs.set(url,blob);return url};
  w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)})};
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>copied.push(text)}});
}
const fileText=(w,blob)=>new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(blob)});
async function fillCommand(s,value){
  await s.click('[data-bin-config]');
  await s.input('#ct-config-dialog [name=code]',value.code);
  await s.input('#ct-config-dialog [name=name]',value.name);
  await s.input('#ct-config-dialog [name=config]',JSON.stringify(value));
  await s.click('#ct-config-dialog [data-validate]');
}
async function submitCommand(s){s.find('#ct-config-dialog form').dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true}));await s.wait(70)}

test('studio JSON transformations, keyboard search, clipboard and download match the original runtime',async()=>{
  const results=[];
  for(const enhanced of [false,true]){
    const downloads=[],copied=[],s=await createStudio({route:'tools/json',enhanced,beforeParse:w=>captureFiles(w,downloads,copied)});
    try{
      const snapshots=[];
      await s.input('#ct-json-input','{"id":18446744073709551615,"values":["same","same"],"text":"中文"}');
      for(const action of ['format','compact','escape','unescape','validate','copy','download']){
        await s.click('[data-json-action="'+action+'"]');
        snapshots.push({value:s.find('#ct-json-input').value,message:s.find('#ct-json-message').textContent});
      }
      const editor=s.find('#ct-json-input');
      editor.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
      assert.equal(s.d.activeElement,s.find('#ct-json-search'));
      await s.input('#ct-json-search','same');
      const selected=[];
      for(const shiftKey of [false,false,true]){
        s.find('#ct-json-search').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Enter',shiftKey,bubbles:true,cancelable:true}));
        selected.push([editor.selectionStart,editor.selectionEnd,editor.value.slice(editor.selectionStart,editor.selectionEnd)]);
      }
      assert.deepEqual(selected.map(item=>item[2]),['same','same','same']);
      assert.notEqual(selected[0][0],selected[1][0]);assert.deepEqual(selected[0],selected[2]);
      assert.equal(downloads.length,1);assert.equal(downloads[0].name,'json-result.txt');
      const content=await fileText(s.w,downloads[0].blob);assert.equal(content,editor.value);assert.deepEqual(copied,[editor.value]);
      results.push({snapshots,selected,copied,content});assert.deepEqual(s.errors,[]);
    }finally{s.close()}
  }
  assert.deepEqual(results[1],results[0],'Presentation keeps the original processing/output semantics');
});

test('studio Binlog import, parse, exports and revision-checked delete work through isolated fixtures',async t=>{
  const downloads=[],s=await createStudio({route:'tools/binlog',beforeParse:w=>captureFiles(w,downloads,[])});t.after(s.close);
  await fillCommand(s,definition);assert.equal(s.find('[data-save]').disabled,false);
  await submitCommand(s);assert.equal(s.d.querySelector('#ct-config-dialog'),null);
  assert.ok(s.find('[data-bin-command="abcd"]'));
  const saved=s.requests.filter(r=>r.path==='/api/tools/binlog/commands'&&r.method==='POST');
  assert.equal(saved.length,1);assert.deepEqual(JSON.parse(JSON.stringify(saved[0].body)),{definition,expectedRevision:null});
  await s.click('[data-bin-sample]');await s.click('[data-bin-parse]');
  assert.match(s.find('#ct-bin-results').textContent,/解析成功/);
  await s.click('[data-bin-config-download]');await s.click('[data-bin-json]');await s.click('[data-bin-excel]');
  assert.deepEqual(downloads.map(file=>file.name),['abcd.json','binlog-result.json','binlog-abcd.xlsx']);
  assert.deepEqual(JSON.parse(await fileText(s.w,downloads[0].blob)),definition);
  const result=JSON.parse(await fileText(s.w,downloads[1].blob));assert.equal(result.summary.success,1);
  const exports=s.requests.filter(r=>r.path==='/api/tools/binlog/export');assert.equal(exports.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(exports[0].body)),{code:'abcd',text:'abcd0001',batch:false,feature:null,revision:result.revision});
  assert.ok(downloads[2].blob.size>0);
  s.w.confirm=()=>false;await s.click('[data-bin-delete]');assert.equal(s.requests.filter(r=>r.method==='DELETE').length,0);
  s.w.confirm=()=>true;await s.click('[data-bin-delete]');
  const deletions=s.requests.filter(r=>r.method==='DELETE');assert.equal(deletions.length,1);assert.equal(deletions[0].path,'/api/tools/binlog/commands/abcd');assert.equal(deletions[0].body.revision,result.revision);
  assert.equal(s.d.querySelector('[data-bin-command="abcd"]'),null);assert.deepEqual(s.errors,[]);
});

test('studio Binlog replacement requires explicit confirmation and deletion restores the builtin definition',async t=>{
  const s=await createStudio({route:'tools/binlog'});t.after(s.close);
  const original=await (await s.w.fetch('/api/tools/binlog/commands')).json();
  const builtin=original[0],replacement={...definition,code:builtin.code,name:'覆盖内置命令',sample:builtin.code+'0001'};
  await fillCommand(s,replacement);
  assert.equal(s.find('[data-save]').disabled,true);assert.equal(s.find('#ct-config-conflict').hidden,false);
  await submitCommand(s);assert.equal(s.requests.filter(r=>r.path==='/api/tools/binlog/commands'&&r.method==='POST').length,0);
  await s.click('#ct-config-dialog [name=replace]');await submitCommand(s);
  const saved=s.requests.filter(r=>r.path==='/api/tools/binlog/commands'&&r.method==='POST');assert.equal(saved.length,1);assert.equal(saved[0].body.expectedRevision,builtin.revision);
  assert.match(s.find('.dt-command-selected').textContent,/覆盖内置命令/);
  await s.click('[data-bin-delete]');assert.equal(s.d.querySelector('[data-bin-delete]'),null);
  const restored=await (await s.w.fetch('/api/tools/binlog/commands')).json();
  assert.deepEqual(restored.find(c=>c.code===builtin.code),builtin);assert.deepEqual(s.errors,[]);
});

test('studio Binlog validation and stale revisions keep the dialog draft without automatically replaying writes',async t=>{
  const s=await createStudio({route:'tools/binlog'});t.after(s.close);
  await fillCommand(s,{...definition,fields:[]});
  assert.equal(s.find('[data-save]').disabled,true);assert.match(s.find('#ct-config-status').textContent,/校验失败/);
  await s.input('#ct-config-dialog [name=config]',JSON.stringify(definition));await s.click('[data-validate]');
  assert.equal(s.find('[data-save]').disabled,false);
  const other={...definition,name:'其他用户新建的命令'};
  const concurrent=await s.w.fetch('/api/tools/binlog/commands',{method:'POST',body:JSON.stringify({definition:other,expectedRevision:null})});assert.equal(concurrent.status,201);
  await submitCommand(s);
  assert.match(s.find('#ct-config-status').textContent,/保存失败.*重新校验/);
  assert.equal(s.find('[name=config]').value,JSON.stringify(definition));assert.equal(s.find('[data-save]').disabled,true);
  await s.wait(180);assert.equal(s.requests.filter(r=>r.path==='/api/tools/binlog/commands'&&r.method==='POST').length,2,'The failed UI write is not replayed');
  await s.click('[data-validate]');assert.equal(s.find('[data-save]').disabled,true);
  await s.click('[name=replace]');await submitCommand(s);
  assert.equal(s.d.querySelector('#ct-config-dialog'),null);
  assert.equal(s.requests.filter(r=>r.path==='/api/tools/binlog/commands'&&r.method==='POST').length,3);
  assert.deepEqual(s.errors,[]);
});
