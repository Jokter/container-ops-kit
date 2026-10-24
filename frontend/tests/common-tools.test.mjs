import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,30));
const command={code:'abcd',name:'测试 <img src=x>',fields:[],sample:'abcd0000',builtin:true,revision:'r1'};
function page(hash='',parseResult=null){
 const calls=[];const dom=new JSDOM(html,{url:'http://localhost/'+hash,runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async(url,options={})=>{calls.push({url,...options});const data=url==='/api/tools/binlog/commands/validate'?{...command,conflict:null}:url==='/api/tools/binlog/commands'?(options.method?command:[command]):url==='/api/tools/binlog/parse'?parseResult??{revision:'r1',summary:{total:1,success:1,errors:0,filtered:0},records:[{line:1,status:'success',result:{bytes:4,warnings:[],fields:[{group:'报文头',tag:'',path:'cmdCode',label:'命令码',value:'abcd',meaning:'',unit:'',description:'<script>bad()</script>'}]}}]}:[];return {ok:true,status:200,json:async()=>data};};}});return {dom,d:dom.window.document,calls};
}
test('workspace and tool whole cards navigate; favorites and keyboard work without double navigation',async()=>{
 const {dom,d,calls}=page();try{await wait();assert.equal(d.querySelectorAll('.pr-space-card').length,5);d.querySelector('[data-workspace-card=tools]').click();assert.equal(dom.window.location.hash,'#/tools/catalog');assert.equal(d.querySelectorAll('[data-tool-card]').length,2);
 d.querySelector('[data-tool-favorite=json]').click();assert.equal(dom.window.location.hash,'#/tools/catalog');assert.equal(d.querySelector('[data-tool-favorite=json]').getAttribute('aria-pressed'),'true');
 d.querySelector('[data-tool-card=json]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(dom.window.location.hash,'#/tools/json');assert.ok(d.querySelector('#ct-json-input'));assert.ok(calls.every(x=>x.url==='/api/platform/applications'));
 }finally{dom.window.close();}
});
test('JSON format/compact/validate/escape/unescape execute locally and invalid input never remains a successful result',async()=>{
 const {dom,d,calls}=page('#/tools/json');try{await wait();const run=async(action,input)=>{if(input!==undefined)d.querySelector('#ct-json-input').value=input;d.querySelector('[data-json-action='+action+']').click();await wait();return d.querySelector('#ct-json-input').value;};
 assert.equal(await run('format','{"a":1}'),'{\n  "a": 1\n}');assert.equal(await run('compact','{ "a": 1 }'),'{"a":1}');
 assert.equal(await run('compact','{ "id": 18446744073709551615, "n": 1.000e+5 }'),'{"id":18446744073709551615,"n":1.000e+5}');
 const text='{"a":"中文\\path"}\nnext';const escaped=await run('escape',text);assert.equal(escaped,JSON.stringify(text).slice(1,-1));assert.equal(await run('unescape',escaped),text);assert.equal(await run('unescape',JSON.stringify(text)),text);
 await run('validate','{"a":true}');assert.match(d.querySelector('#ct-json-message').textContent,/通过/);assert.equal(await run('format','bad'),'bad');assert.ok(d.querySelector('#ct-json-message').classList.contains('ct-error'));assert.ok(calls.every(x=>x.url==='/api/platform/applications'));
 }finally{dom.window.close();}
});
test('Binlog deep link loads real commands and submits actual sample; result is escaped; config validation precedes persistence',async()=>{
 const {dom,d,calls}=page('#/tools/binlog');try{await wait();assert.equal(d.querySelector('.ct-command img'),null);d.querySelector('[data-bin-sample]').click();assert.equal(d.querySelector('#ct-bin-input').value,'abcd0000');d.querySelector('[data-bin-parse]').click();await wait();assert.equal(JSON.parse(calls.find(x=>x.url.endsWith('/parse')).body).text,'abcd0000');assert.match(d.querySelector('#ct-bin-results').textContent,/abcd/);assert.equal(d.querySelector('#ct-bin-results script'),null);
 d.querySelector('[data-bin-config]').click();const form=d.querySelector('#ct-config-dialog form');form.elements.code.value='abcd';form.elements.name.value='新增';form.elements.config.value='[]';assert.equal(d.querySelector('[data-save]').disabled,true);d.querySelector('[data-validate]').click();await wait();assert.equal(d.querySelector('[data-save]').disabled,false);
 form.elements.name.value='改动';form.elements.name.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelector('[data-save]').disabled,true);d.querySelector('[data-validate]').click();await wait();form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(calls.filter(x=>x.url==='/api/tools/binlog/commands'&&x.method==='POST').length,1);assert.equal(d.querySelector('#ct-config-dialog'),null);
 }finally{dom.window.close();}
});
test('JSON uses one editor and search navigates matches after in-place changes',async()=>{
 const {dom,d}=page('#/tools/json');try{await wait();assert.equal(d.querySelectorAll('.ct-editors textarea').length,1);
 const input=d.querySelector('#ct-json-input');input.value='{"a":"same","b":"same"}';input.dispatchEvent(new dom.window.Event('input'));
 const search=d.querySelector('#ct-json-search');search.value='same';search.dispatchEvent(new dom.window.Event('input'));assert.match(d.querySelector('#ct-json-search-count').textContent,/2 处/);
 d.querySelector('[data-json-find=next]').click();assert.equal(input.value.slice(input.selectionStart,input.selectionEnd),'same');const first=input.selectionStart;
 search.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.ok(input.selectionStart>first);d.querySelector('[data-json-find=next]').click();assert.equal(input.selectionStart,first);
 d.querySelector('[data-json-action=format]').click();await wait();assert.match(d.querySelector('#ct-json-input').value,/\n/);assert.match(d.querySelector('#ct-json-search-count').textContent,/2 处/);
 }finally{dom.window.close();}
});
test('Binlog result search filters fields, expands records, and restores results',async()=>{
 const {dom,d,calls}=page('#/tools/binlog');try{await wait();d.querySelector('[data-bin-sample]').click();d.querySelector('[data-bin-parse]').click();await wait();
 const search=d.querySelector('#ct-bin-search');const find=value=>{search.value=value;search.dispatchEvent(new dom.window.Event('input'));};
 find('ABCD');assert.equal(d.querySelector('.ct-record').hidden,false);assert.equal(d.querySelector('.ct-tag-group').open,true);
 find('absent');assert.equal(d.querySelector('.ct-record').hidden,true);assert.equal(d.querySelector('#ct-bin-search-empty').hidden,false);
 find('<script>');assert.equal(d.querySelector('.ct-record').hidden,false);assert.equal(d.querySelector('#ct-bin-results script'),null);
 find('');assert.equal(d.querySelector('tbody tr').hidden,false);assert.equal(d.querySelector('#ct-bin-search-empty').hidden,true);assert.equal(calls.filter(x=>x.url.endsWith('/parse')).length,1);
 }finally{dom.window.close();}
});

test('BIN message tabs isolate tag filters, searches and fold state; errors and filtered records remain accessible',async()=>{
 const field=(tag,value,extra={})=>({tag,value,group:'组 '+tag,path:'field'+tag,label:'字段 '+tag,meaning:'',unit:'',description:'说明',...extra});
 const payload={summary:{total:4,success:2,errors:1,filtered:1},records:[
  {line:2,status:'success',result:{bytes:8,warnings:[],fields:[field('','header'),field('0001','alpha'),field('0002',65535,{invalid:true,issues:[{kind:'invalid',message:'无效值 <img src=x>'}]})]}},
  {line:5,status:'success',result:{bytes:8,warnings:[],fields:[field('0001','beta'),field('0003','gamma',{issues:[{kind:'range',message:'超出范围：0–10'}]})]}},
  {line:6,status:'error',error:'报文截断 <script>bad()</script>'},
  {line:7,status:'filtered',result:{bytes:4,warnings:['未知 tag'],feature:2,expected:3,fields:[]}}
 ]};
 const {dom,d,calls}=page('#/tools/binlog',payload);
 try{
  await wait();d.querySelector('[data-bin-sample]').click();d.querySelector('[data-bin-parse]').click();await wait();
  assert.equal(d.querySelectorAll('[data-bin-message]').length,4);assert.match(d.querySelector('[data-bin-message="1"]').textContent,/第 5 行/);
  assert.equal(d.querySelectorAll('.ct-tag-group').length,3);assert.ok([...d.querySelectorAll('.ct-tag-group')].every(e=>e.open));
  assert.equal(d.querySelector('.ct-bin-invalid img'),null);assert.match(d.querySelector('.ct-bin-invalid').textContent,/无效值/);
  const tag1=()=>d.querySelector('[data-bin-detail="0001"]');tag1().open=false;
  d.querySelector('[data-bin-tag="0002"]').click();assert.equal(d.querySelectorAll('.ct-tag-group').length,1);
  d.querySelector('[data-bin-message="1"]').click();assert.equal(d.querySelectorAll('.ct-tag-group').length,2);assert.match(d.querySelector('#ct-bin-results').textContent,/beta/);assert.equal(d.querySelectorAll('.ct-bin-warning').length,1);
  d.querySelector('[data-bin-tag="0003"]').click();d.querySelector('[data-bin-message="0"]').click();assert.equal(d.querySelector('[data-bin-tag="0002"]').getAttribute('aria-pressed'),'true');
  d.querySelector('[data-bin-tag-all]').click();assert.equal(tag1().open,false);
  const find=q=>{const input=d.querySelector('#ct-bin-search');input.value=q;input.dispatchEvent(new dom.window.Event('input'));};
  find('ALPHA');assert.equal(tag1().open,true);assert.equal(d.querySelectorAll('.ct-tag-group').length,1);
  d.querySelector('[data-bin-message="1"]').click();assert.equal(d.querySelector('#ct-bin-search').value,'');assert.equal(d.querySelector('[data-bin-tag="0003"]').getAttribute('aria-pressed'),'true');
  d.querySelector('[data-bin-message="0"]').click();assert.equal(d.querySelector('#ct-bin-search').value,'ALPHA');find('');assert.equal(tag1().open,false);
  find('beta');assert.equal(d.querySelector('#ct-bin-search-empty').hidden,false);find('');
  d.querySelector('[data-bin-message="2"]').click();assert.match(d.querySelector('#ct-bin-results').textContent,/报文截断/);assert.equal(d.querySelector('#ct-bin-results script'),null);assert.equal(d.querySelectorAll('[data-bin-tag]').length,0);
  d.querySelector('[data-bin-message="3"]').click();assert.match(d.querySelector('#ct-bin-results').textContent,/实际特性标识：2/);assert.match(d.querySelector('#ct-bin-results').textContent,/未知 tag/);
  d.querySelector('[data-bin-parse]').click();await wait();assert.equal(d.querySelector('[data-bin-message="0"]').getAttribute('aria-pressed'),'true');assert.equal(tag1().open,true);assert.equal(calls.filter(x=>x.url.endsWith('/parse')).length,2);
 }finally{dom.window.close();}
});

test('single BIN message has no message switch and defaults to expanded tags',async()=>{
 const {dom,d}=page('#/tools/binlog');try{await wait();d.querySelector('[data-bin-sample]').click();d.querySelector('[data-bin-parse]').click();await wait();assert.equal(d.querySelectorAll('[data-bin-message]').length,0);assert.equal(d.querySelector('.ct-tag-group').open,true);}finally{dom.window.close();}
});
