import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
let runtime='';for(const file of ['build-results.js','deployment-selection.js','deployment-presentation.js','environment-presentation.js','deployment-history.js'])runtime+=(await readFile(new URL('../src/'+file,import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export /gm,'')+'\n;\n';
runtime+='const persistDeploymentSelection=saveDeploymentSelection;\n'+(await readFile(new URL('../src/prototype-runtime.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
const wait=()=>new Promise(r=>setTimeout(r,40));
test('没有现存环境也可查看历史并删除已结束记录',async()=>{
 const requests=[],row={id:'11111111-1111-4111-8111-111111111111',module:'demo',environmentId:42,namespace:'mae',status:'FAILED',mode:'QUICK',revision:2,createdAt:new Date().toISOString(),serviceCount:1,canDelete:true};
 const dom=new JSDOM(html,{url:'http://localhost/#/container/deploy',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,opts)=>{requests.push({url,...opts});return{ok:true,status:opts?.method==='DELETE'?204:200,json:async()=>url==='/api/deployment-tasks'?[row]:url==='/api/build-configuration'?{modules:[]}:[]}}}});
 try{dom.window.eval(runtime);await wait();const d=dom.window.document;assert.ok(d.querySelector('[data-dh-tab="history"]'));d.querySelector('[data-dh-tab="history"]').click();await wait();d.querySelector('[data-dh-delete]').click();assert.equal(requests.filter(r=>r.method==='DELETE').length,0);d.querySelector('[data-dh-confirm]').click();await wait();assert.equal(requests.filter(r=>r.method==='DELETE').length,1);assert.equal(d.querySelector('[data-dh-delete]'),null);}finally{dom.window.close()}
});

test('部署日志默认折叠，重绘保留展开和 values 草稿，服务与日志内容均保留',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const task={id,mode:'REVIEW',status:'AWAITING_REVIEW',environmentId:1,artifactId:1,module:'demo',namespace:'mae',revision:1,services:{demo:{service:'demo',stage:'ANALYZED',values:'replicas: 1',replaceItems:[],unresolvedImages:[],errors:[]}}};
 const dom=new JSDOM(html,{url:'http://localhost/#/container/deploy',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.EventSource=class{close(){}addEventListener(){}};w.localStorage.setItem('container-ops-kit.active-deployment-task',id);w.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/environments'?[{id:1,type:'CONTAINER',name:'demo',host:'192.0.2.1',releaseVersion:{id:1},sshPort:22,connectionStatus:'REACHABLE'}]:url==='/api/release-versions'?[{id:1,code:'R27C10',name:'demo'}]:url==='/api/deployment-tasks/'+id?task:url==='/api/build-configuration'?{modules:[]}:[]})}});
 try{dom.window.eval(runtime);await wait();const d=dom.window.document;assert.equal(d.querySelector('.deployment-log-disclosure').open,false);assert.ok(d.querySelector('.deployment-services-panel'));assert.ok(d.querySelector('#deployment-log-terminal'));
 d.querySelector('.deployment-log-disclosure').open=true;const input=d.querySelector('#deployment-values');input.value='replicas: 3';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));dom.window.eval('render(false)');assert.equal(d.querySelector('.deployment-log-disclosure').open,true);assert.equal(d.querySelector('#deployment-values').value,'replicas: 3');
 }finally{await wait();dom.window.close()}
});
