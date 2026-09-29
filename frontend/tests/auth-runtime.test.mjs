import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../src/auth-runtime.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('login is required before API calls; errors, account defaults and per-user browser state work',async()=>{
 const requests=[],dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
 w.Headers=Headers;w.Request=Request;w.fetch=async(url,options={})=>{requests.push({url,options});if(url==='/api/auth/login-config')return{ok:true,status:200,json:async()=>({defaultPassword:'test-password'})};if(url==='/api/auth/me')return{ok:false,status:401};if(url==='/api/auth/login'){const input=JSON.parse(options.body);return input.account==='alice'&&input.password==='test-password'?{ok:true,status:200,json:async()=>({account:input.account,workDirectory:'/usr1/wytest/'+input.account})}:{ok:false,status:401,json:async()=>({message:'账号未获授权或密码不正确'})};}return{ok:true,status:200,json:async()=>[]};};
 try{w.eval(source);await tick();const shadow=w.document.getElementById('ops-login').shadowRoot;assert.equal(w.document.getElementById('app').hidden,true);assert.match(shadow.textContent,/统一管理运维与自动化任务/);assert.doesNotMatch(shadow.textContent,/\/usr1\/wytest|演示账号|交互预览/);
 const pending=w.fetch('/api/environments');await tick();assert.equal(requests.some(r=>r.url==='/api/environments'),false);
 assert.equal(shadow.getElementById('password').value,'test-password');assert.equal(shadow.getElementById('password').type,'password');assert.equal(shadow.getElementById('password').readOnly,true);assert.match(shadow.querySelector('.mini').textContent,/自动化空间/);shadow.getElementById('account').value='mallory';shadow.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(shadow.getElementById('error').textContent,/密码/);
 shadow.getElementById('account').value='alice';shadow.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await pending;assert.equal(w.opsAuth.user.account,'alice');assert.equal(w.document.getElementById('app').hidden,false);assert.equal(requests.at(-1).options.headers.get('X-Ops-Account'),'alice');
 w.opsAuth.storage.local.setItem('task','alice-task');w.opsAuth.user={account:'bob'};assert.equal(w.opsAuth.storage.local.getItem('task'),null);w.opsAuth.storage.local.setItem('task','bob-task');w.opsAuth.user={account:'alice'};assert.equal(w.opsAuth.storage.local.getItem('task'),'alice-task');
 }finally{w.close();}
});

test('unavailable public login configuration keeps account login disabled',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;let submitted=false;
 w.Headers=Headers;w.Request=Request;w.fetch=async url=>{if(url==='/api/auth/login')submitted=true;return{ok:false,status:url==='/api/auth/me'?401:503,json:async()=>({message:'unavailable'})};};
 try{w.eval(source);await tick();const shadow=w.document.getElementById('ops-login').shadowRoot;assert.equal(shadow.getElementById('login-submit').disabled,true);assert.match(shadow.getElementById('error').textContent,/加载登录配置/);shadow.getElementById('login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(submitted,false);}finally{w.close();}
});
