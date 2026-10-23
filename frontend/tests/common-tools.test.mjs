import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,30));
const command={code:'abcd',name:'测试 <img src=x>',fields:[],sample:'abcd0000',builtin:true,revision:'r1'};
function page(hash=''){
 const calls=[];const dom=new JSDOM(html,{url:'http://localhost/'+hash,runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async(url,options={})=>{calls.push({url,...options});const data=url==='/api/tools/binlog/commands/validate'?{...command,conflict:null}:url==='/api/tools/binlog/commands'?(options.method?command:[command]):url==='/api/tools/binlog/parse'?{revision:'r1',summary:{total:1,success:1,errors:0,filtered:0},records:[{line:1,status:'success',result:{bytes:4,warnings:[],fields:[{group:'报文头',tag:'',path:'cmdCode',label:'命令码',value:'abcd',meaning:'',unit:'',description:'<script>bad()</script>'}]}}]}:[];return {ok:true,status:200,json:async()=>data};};}});return {dom,d:dom.window.document,calls};
}
test('workspace and tool whole cards navigate; favorites and keyboard work without double navigation',async()=>{
 const {dom,d,calls}=page();try{await wait();assert.equal(d.querySelectorAll('.pr-space-card').length,5);d.querySelector('[data-workspace-card=tools]').click();assert.equal(dom.window.location.hash,'#/tools/catalog');assert.equal(d.querySelectorAll('[data-tool-card]').length,2);
 d.querySelector('[data-tool-favorite=json]').click();assert.equal(dom.window.location.hash,'#/tools/catalog');assert.equal(d.querySelector('[data-tool-favorite=json]').getAttribute('aria-pressed'),'true');
 d.querySelector('[data-tool-card=json]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(dom.window.location.hash,'#/tools/json');assert.ok(d.querySelector('#ct-json-input'));assert.ok(calls.every(x=>x.url==='/api/platform/applications'));
 }finally{dom.window.close();}
});
test('JSON format/compact/validate/escape/unescape execute locally and invalid input never remains a successful result',async()=>{
 const {dom,d,calls}=page('#/tools/json');try{await wait();const run=async(action,input)=>{if(input!==undefined)d.querySelector('#ct-json-input').value=input;d.querySelector('[data-json-action='+action+']').click();await wait();return d.querySelector('#ct-json-output').value;};
 assert.equal(await run('format','{"a":1}'),'{\n  "a": 1\n}');assert.equal(await run('compact','{ "a": 1 }'),'{"a":1}');
 assert.equal(await run('compact','{ "id": 18446744073709551615, "n": 1.000e+5 }'),'{"id":18446744073709551615,"n":1.000e+5}');
 const text='{"a":"中文\\path"}\nnext';const escaped=await run('escape',text);assert.equal(escaped,JSON.stringify(text).slice(1,-1));assert.equal(await run('unescape',escaped),text);assert.equal(await run('unescape',JSON.stringify(text)),text);
 await run('validate','{"a":true}');assert.match(d.querySelector('#ct-json-message').textContent,/通过/);assert.equal(await run('format','bad'),'');assert.ok(d.querySelector('#ct-json-message').classList.contains('ct-error'));assert.ok(calls.every(x=>x.url==='/api/platform/applications'));
 }finally{dom.window.close();}
});
test('Binlog deep link loads real commands and submits actual sample; result is escaped; config validation precedes persistence',async()=>{
 const {dom,d,calls}=page('#/tools/binlog');try{await wait();assert.equal(d.querySelector('.ct-command img'),null);d.querySelector('[data-bin-sample]').click();assert.equal(d.querySelector('#ct-bin-input').value,'abcd0000');d.querySelector('[data-bin-parse]').click();await wait();assert.equal(JSON.parse(calls.find(x=>x.url.endsWith('/parse')).body).text,'abcd0000');assert.match(d.querySelector('#ct-bin-results').textContent,/abcd/);assert.equal(d.querySelector('#ct-bin-results script'),null);
 d.querySelector('[data-bin-config]').click();const form=d.querySelector('#ct-config-dialog form');form.elements.code.value='abcd';form.elements.name.value='新增';form.elements.config.value='[]';assert.equal(d.querySelector('[data-save]').disabled,true);d.querySelector('[data-validate]').click();await wait();assert.equal(d.querySelector('[data-save]').disabled,false);
 form.elements.name.value='改动';form.elements.name.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelector('[data-save]').disabled,true);d.querySelector('[data-validate]').click();await wait();form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(calls.filter(x=>x.url==='/api/tools/binlog/commands'&&x.method==='POST').length,1);assert.equal(d.querySelector('#ct-config-dialog'),null);
 }finally{dom.window.close();}
});
