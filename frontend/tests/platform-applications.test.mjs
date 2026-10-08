import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const sample={id:'11111111-1111-4111-8111-111111111111',revision:0,name:'日志 <img src=x>',description:'检索 <script>bad()</script>',url:'http://192.0.2.20:5601/',category:'日志检索',openMode:'embedded',workspace:'container',owner:'运维',environment:'研发'};
function page(hash='',initial=[],handler){
 const calls=[],opened=[];let rows=structuredClone(initial);
 const dom=new JSDOM(html,{url:'http://localhost/'+hash,runScripts:'dangerously',beforeParse(w){
  w.scrollTo=()=>{};w.open=(...args)=>opened.push(args);
  w.fetch=async(url,options={})=>{calls.push({url,...options});if(handler){const response=await handler(url,options);if(response)return response;}
   const method=options.method||'GET';let data=[];
   if(url==='/api/platform/applications'&&method==='GET')data=rows;
   if(url==='/api/platform/applications'&&method==='POST'){data={...JSON.parse(options.body),id:sample.id,revision:0};rows.push(data);}
   if(url==='/api/platform/overview')data={running:3,attention:1,applications:rows.length,environments:{total:2,reachable:1},updatedAt:new Date().toISOString(),todos:[{kind:'build',id:sample.id,title:'已有构建',reason:'构建失败',domain:'container',page:'build'}]};
   return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
 }});return {dom,d:dom.window.document,calls,opened};
}
test('default tool center exposes four real spaces, original deep links and shared applications',async()=>{
 const {dom,d,calls}=page();try{await pause();assert.equal(dom.window.location.hash,'#/home/tools');assert.equal(d.querySelectorAll('.pr-space-card').length,4);assert.equal(d.querySelector('.pr-home h1').textContent,'工具中心');assert.deepEqual(calls.map(x=>x.url),['/api/platform/applications']);
 d.querySelector('[data-portal-space="virtualization"]').click();assert.ok(d.querySelector('.platform-placeholder'));d.querySelector('[data-platform-domain="applications"]').click();assert.equal(dom.window.location.hash,'#/applications');assert.match(d.body.textContent,/全平台共享/);
 d.querySelector('[data-platform-domain="container"]').click();d.querySelector('[data-page="build"]').click();d.querySelector('[data-platform-domain="applications"]').click();d.querySelector('[data-platform-domain="container"]').click();assert.equal(dom.window.location.hash,'#/container/build');await pause();
 }finally{dom.window.close();}
});
test('application creation writes once, favorite stays browser local, embedded route survives refresh without iframe recreation',async()=>{
 const {dom,d,calls}=page('#/applications');try{await pause();d.querySelector('[data-app-create]').click();const form=d.querySelector('#ac-form');form.elements.name.value=sample.name;form.elements.url.value=sample.url;form.elements.description.value=sample.description;form.elements.workspace.value='container';
 const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));submit();submit();await pause();assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal(d.querySelector('.ac-card h2').textContent,sample.name);assert.equal(d.querySelector('.ac-card img'),null);assert.equal(d.querySelector('.ac-card script'),null);
 d.querySelector('[data-app-favorite]').click();assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('ops-application-favorites')),[sample.id]);assert.equal(calls.filter(x=>x.method).length,1);
 d.querySelector('[data-platform-domain="container"]').click();d.querySelector('.pr-related [data-pr-app]').click();assert.equal(dom.window.location.hash,'#/container/app/'+sample.id);const frame=d.querySelector('#ac-frame');assert.equal(frame.getAttribute('src'),sample.url);dom.window.render(false);assert.equal(d.querySelector('#ac-frame'),frame);
 d.querySelector('[data-app-back]').click();assert.equal(dom.window.location.hash,'#/container/resources');await pause();
 }finally{dom.window.close();}
});
test('embedded deep link loads stored app; external app opens independently',async()=>{
 const {dom,d,opened}=page('#/applications/app/'+sample.id,[sample]);try{await pause();assert.ok(d.querySelector('#ac-frame'));assert.equal(d.querySelector('#ac-frame').title,sample.name);d.querySelector('[data-app-back]').click();await pause();}finally{dom.window.close();}
 const external=page('#/applications',[{...sample,openMode:'newtab'}]);try{await pause();external.d.querySelector('[data-pr-app]').click();assert.deepEqual(external.opened,[[sample.url,'_blank','noopener,noreferrer']]);assert.equal(external.dom.window.location.hash,'#/applications');}finally{external.dom.window.close();}
});
test('failed edit keeps draft, does not retry; delete requires confirmation and revision',async()=>{
 const {dom,d,calls}=page('#/applications',[sample],async(url,options)=>options.method==='PUT'?{ok:false,status:409,json:async()=>({message:'应用已被修改'})}:options.method==='DELETE'?{ok:true,status:204}:null);
 try{await pause();d.querySelector('[data-app-edit]').click();const form=d.querySelector('#ac-form');form.elements.name.value='保留草稿';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await pause();assert.equal(d.querySelector('[name=name]').value,'保留草稿');assert.match(d.querySelector('#ac-form-error').textContent,/应用已被修改/);assert.equal(calls.filter(x=>x.method==='PUT').length,1);
 d.querySelector('[data-app-delete]').click();assert.equal(calls.filter(x=>x.method==='DELETE').length,0);d.querySelector('[data-app-delete-cancel]').click();assert.equal(d.querySelector('#ac-delete-check').hidden,true);d.querySelector('[data-app-delete]').click();d.querySelector('[data-app-delete-confirm]').click();await pause();assert.deepEqual(JSON.parse(calls.find(x=>x.method==='DELETE').body),{revision:0});assert.equal(d.querySelector('.ac-card'),null);
 }finally{dom.window.close();}
});
test('global overview reads stored summary and opens existing task without creating work',async()=>{
 const {dom,d,calls}=page('#/home/overview');try{await pause();assert.match(d.querySelector('.pr-stats').textContent,/3/);assert.match(d.body.textContent,/已有构建/);let detail;d.addEventListener('platform-open-delivery-task',e=>detail=e.detail);d.querySelector('[data-platform-todo]').click();assert.equal(dom.window.location.hash,'#/container/build');assert.equal(detail.id,sample.id);assert.ok(calls.every(x=>!x.method));await pause();}finally{dom.window.close();}
});
