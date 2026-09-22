import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));

test('Java 设置可回显、保存和清除，取消编辑不保存',async()=>{
 let saved={java:{mavenRepository:'D:\\Maven Cache\\repository'}},writes=0;
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/settings',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,options)=>({ok:true,status:200,json:async()=>{if(url==='/api/automation/language-settings'){if(options?.method==='PUT'){saved=JSON.parse(options.body);writes++;}return structuredClone(saved);}return [];}});}});
 try{await pause();const d=dom.window.document;
  const open=async()=>{d.querySelector('[data-qw-drawer="java-settings"]').click();await pause();return d.querySelector('#java-maven-repository');};
  let input=await open();assert.equal(input.value,saved.java.mavenRepository);
  input.value='D:/another repo';input.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-save]').click();await pause();assert.equal(saved.java.mavenRepository,'D:/another repo');assert.equal(writes,1);assert.equal(d.querySelector('[role=dialog]'),null);
  input=await open();assert.equal(input.value,'D:/another repo');input.value='unsaved';input.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-close]').click();assert.equal(writes,1);
  input=await open();assert.equal(input.value,'D:/another repo');input.value='';input.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-qw-save]').click();await pause();assert.equal(saved.java.mavenRepository,'');assert.equal(writes,2);
 }finally{dom.window.close();}
});
