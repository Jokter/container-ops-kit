import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../src/admin-runtime.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('admin view selects users, pages tasks, escapes content and returns to unchanged workspace',async()=>{
 const dom=new JSDOM('<button data-ops-admin>用户管理</button><main>我的工作空间</main>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,requests=[];
 w.opsAuth={user:{account:'alice',isAdmin:true}};
 w.fetch=async url=>{requests.push(url);if(url==='/api/admin/users')return{ok:true,json:async()=>({users:[{account:'alice',allowed:true,isAdmin:true,loginCount:1,tasks:0},{account:'bob',allowed:true,isAdmin:false,loginCount:2,tasks:31}]})};const query=new URL(url,'http://localhost').searchParams;return{ok:true,json:async()=>({total:31,items:[{id:query.get('page'),kind:'quality-job',title:'<img src=x onerror=alert(1)>',status:'SUCCEEDED',progress:null}]})};};
 try{w.eval(source);w.document.querySelector('button').click();await tick();const root=w.document.getElementById('ops-admin').shadowRoot;root.querySelector('[data-user="bob"]').click();await tick();assert.match(requests.at(-1),/account=bob/);assert.equal(root.querySelector('img'),null);assert.match(root.getElementById('tasks').textContent,/<img/);root.getElementById('next').click();await tick();assert.match(requests.at(-1),/page=2/);root.getElementById('kind').value='platform';root.getElementById('kind').dispatchEvent(new w.Event('change'));await tick();assert.match(requests.at(-1),/kind=platform/);assert.match(requests.at(-1),/page=1/);root.getElementById('close').click();assert.equal(w.document.getElementById('ops-admin'),null);assert.equal(w.document.querySelector('main').textContent,'我的工作空间');}finally{w.close();}
});
test('ordinary users cannot open admin view even through an injected button',()=>{
 const dom=new JSDOM('<button data-ops-admin>用户管理</button>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;w.opsAuth={user:{isAdmin:false}};try{w.eval(source);w.document.querySelector('button').click();assert.equal(w.document.getElementById('ops-admin'),null);}finally{w.close();}
});
