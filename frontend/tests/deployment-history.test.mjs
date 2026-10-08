import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=(await readFile(new URL('../src/deployment-history.js',import.meta.url),'utf8')).replace('export function','function');
const wait=()=>new Promise(r=>setTimeout(r,20));
test('部署记录勾选、确认取消、批量部分失败及防重复；运行中不能删除',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'dangerously'}),d=dom.window.document,calls=[],removed=[];let release;
 const create=dom.window.eval(source+'\ncreateDeploymentHistory');let view;const render=()=>{d.querySelector('main').innerHTML=view.html()};
 const rows=['done','failed','running'].map((id,i)=>({id,revision:3,canDelete:i<2,mode:'QUICK',status:i<2?'FAILED':'DEPLOYING',environmentId:1,module:'swm',namespace:'mae',serviceCount:1,createdAt:new Date().toISOString()}));
 view=create({render,escapeHtml:String,removed:id=>removed.push(id),openTask:async()=>{},request:async(url,options)=>{if(!options)return rows;calls.push({url,...options});if(url.endsWith('failed'))throw Error('版本变化');await new Promise(r=>release=r)}});
 try{await view.load();assert.equal(d.querySelector('[data-dh-delete="running"]').disabled,true);d.querySelector('[data-dh-all]').click();d.querySelector('[data-dh-delete-selected]').click();assert.equal(calls.length,0);d.querySelector('[data-dh-cancel]').click();assert.equal(calls.length,0);
 d.querySelector('[data-dh-delete-selected]').click();d.querySelector('[data-dh-confirm]').click();assert.equal(d.querySelector('[data-dh-confirm]').disabled,true);d.querySelector('[data-dh-confirm]').click();assert.equal(calls.length,1);release();await wait();assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].body),{expectedRevision:3});assert.deepEqual(removed,['done']);assert.match(d.body.textContent,/版本变化/);assert.ok(d.querySelector('[data-dh-delete="failed"]'));assert.equal(d.querySelector('[data-dh-delete="done"]'),null);
 }finally{dom.window.close()}
});
