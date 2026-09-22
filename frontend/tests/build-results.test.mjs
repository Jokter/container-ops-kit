import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'
const source=(await readFile(new URL('../src/build-results.js',import.meta.url),'utf8')).replace("import './build-results.css'",'').replace('export function','function')
const pack={service:'demo',filename:'demo.tgz',kind:'directory',size:100,version:'1.0'}
function setup(result){
 const dom=new JSDOM('<main></main>',{runScripts:'dangerously',url:'http://localhost/'}),d=dom.window.document,requests=[]
 const create=dom.window.eval(source+'\ncreateBuildResults')
 let task={id:'task1',status:'SUCCEEDED',mode:result.comparison?'COMPARE':'SINGLE',baseline:{archDesignBranch:'master'},candidate:{archDesignBranch:'feature'}}
 let view
 const render=()=>{d.querySelector('main').innerHTML=view.html(task)}
 view=create({request:async url=>{requests.push(url);return result},render,toast:()=>{},escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))})
 return{dom,d,requests,view,render,task}
}
test('服务包选择、过滤保留选择且空列表不会提供错误下载',async()=>{
 const c=setup({packages:[pack,{...pack,service:'other'}],comparison:null});try{await c.view.load(c.task);c.render();assert.equal(c.d.querySelectorAll('[data-br-download]').length,2);c.d.querySelector('[data-br-all]').click();assert.equal(c.d.querySelector('[data-br-batch]').disabled,false);const input=c.d.querySelector('#br-search');input.value='absent';input.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));assert.equal(c.d.querySelectorAll('[data-br-download]').length,0);assert.match(c.d.body.textContent,/已选择 2 项/);assert.equal(c.requests.length,1);}finally{c.dom.window.close()}
})
test('独立差异详情、过滤无差异、缺失侧下载按钮及 HTML 转义',async()=>{
 const file={path:'values.yaml',status:'MODIFIED',patch:'-replicas: 2\n+replicas: 3\n+<img src=x onerror=alert(1)>',binary:false,truncated:true,beforeBytes:10,afterBytes:20};
 const c=setup({packages:[],comparison:[{service:'demo',status:'MODIFIED',baseline:pack,candidate:pack,files:[file]},{service:'new',status:'ADDED',baseline:null,candidate:{...pack,service:'new'},files:[{...file,status:'ADDED'}]},{service:'same',status:'UNCHANGED',baseline:pack,candidate:pack,files:[]}]});try{await c.view.load(c.task);c.render();assert.match(c.d.querySelector('.br-code').textContent,/replicas: 3/);assert.equal(c.d.querySelector('img'),null);assert.match(c.d.querySelector('.br-warning').textContent,/截断/);c.d.querySelector('[data-br-service="new"]').click();assert.equal(c.d.querySelector('[data-br-side="baseline"]'),null);assert.ok(c.d.querySelector('[data-br-side="candidate"]'));c.d.querySelector('[data-br-filter="UNCHANGED"]').click();assert.equal(c.d.querySelectorAll('[data-br-service]').length,1);assert.match(c.d.querySelector('.br-detail').textContent,/内容一致/);}finally{c.dom.window.close()}
})
test('旧任务请求晚返回不能覆盖新任务结果，失败可手动重新读取',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'dangerously'});try{let release;const pending=new Promise(resolve=>release=resolve);let attempts=0;const create=dom.window.eval(source+'\ncreateBuildResults');const view=create({request:async url=>{if(url.includes('/old/'))return pending;if(++attempts===1)throw Error('目录不存在');return{packages:[pack],comparison:null}},render:()=>{},toast:()=>{},escapeHtml:String});const old={id:'old',status:'SUCCEEDED',mode:'SINGLE'},next={...old,id:'new'};const p=view.load(old);await view.load(next);release({packages:[{...pack,service:'wrong'}],comparison:null});await p;assert.match(view.html(next),/目录不存在/);await view.load(next,true);assert.match(view.html(next),/demo.tgz/);assert.doesNotMatch(view.html(next),/wrong/);}finally{dom.window.close()}
})

test('完整构建页面恢复历史任务并显示结果，模式切换不会串用旧结果',async()=>{
 const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
 const runtime=(await readFile(new URL('../src/prototype-runtime.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'')
 const task={id:'00000000-0000-4000-8000-000000000001',mode:'COMPARE',status:'SUCCEEDED',module:'mae-access',environmentId:1,environmentName:'build',progress:100,events:[],directories:[],baseline:{archDesignBranch:'master',cbbWebDevBranch:'master'},candidate:{archDesignBranch:'feature',cbbWebDevBranch:'master'}}
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.EventSource=class{close(){}};w.localStorage.setItem('container-ops-kit.active-build-task',task.id);w.fetch=async url=>{let result=[];if(url==='/api/release-versions')result=[{id:1,code:'R27C10',name:'R27C10'}];else if(url==='/api/environments')result=[{id:1,releaseVersion:{id:1},type:'BUILD',name:'build',host:'localhost',sshPort:22,workDirectory:'/opt/build',connectionStatus:'REACHABLE'}];else if(url==='/api/build-configuration')result={modules:[{name:'mae-access'}],defaultBranch:'master'};else if(url==='/api/build-tasks')result=[task];else if(url.endsWith('/results'))result={packages:[],comparison:[{service:'demo',status:'UNCHANGED',baseline:pack,candidate:pack,files:[]}]};else if(url.startsWith('/api/build-tasks/'))result=task;else if(url.endsWith('/storage'))result={};return{ok:true,status:200,json:async()=>result}};}})
 try{dom.window.eval(source);dom.window.eval(runtime);await new Promise(r=>setTimeout(r,80));const d=dom.window.document;d.querySelector('[data-page="build"]').click();await new Promise(r=>setTimeout(r,80));assert.ok(d.querySelector('[data-br-service="demo"]'));assert.match(d.querySelector('.br-detail').textContent,/内容一致/);assert.equal(d.querySelector('.br-config').open,false);d.querySelector('[data-build-tab="single"]').click();assert.equal(d.querySelector('.br-results'),null);assert.equal(d.querySelector('.br-config').open,true);}finally{await new Promise(r=>setTimeout(r,0));dom.window.close()}
})
