import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
test('connection settings saves MCP independently of token and restores defaults only after save',async()=>{
 const defaults={packageUrl:'https://example.test/default.tar.gz',indexUrl:'https://example.test/simple',insecureHosts:'example.test'};
 let config={...defaults,packageUrl:'https://example.test/custom.tar.gz'},writes=0,tokenWrites=0;
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/settings',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,options)=>({ok:true,status:200,json:async()=>{
  if(url==='/api/auto-ut/welink-mcp-settings'){if(options?.method==='PUT'){config=JSON.parse(options.body);writes++;}return {config:{...config},defaults};}
  if(url==='/api/auto-ut/welink-settings'){if(options?.method)tokenWrites++;return {configured:true};}
  return [];
 }});}});
 try{await pause();const d=dom.window.document;d.querySelector('[data-qw-drawer="connection"]').click();await pause();
  assert.equal(d.querySelector('#welink-mcp-packageUrl').value,config.packageUrl);
  assert.equal(d.querySelector('#welink-token').value,'');
  d.querySelector('#welink-mcp-packageUrl').value='https://example.test/new.tar.gz';d.querySelector('#welink-mcp-save').click();await pause();
  assert.equal(config.packageUrl,'https://example.test/new.tar.gz');assert.equal(writes,1);assert.equal(tokenWrites,0);
  d.querySelector('#welink-mcp-default').click();assert.equal(writes,1);assert.equal(d.querySelector('#welink-mcp-packageUrl').value,defaults.packageUrl);
  d.querySelector('#welink-mcp-save').click();await pause();assert.deepEqual(config,defaults);assert.equal(writes,2);
  d.querySelector('[data-qw-close]').click();d.querySelector('[data-qw-drawer="connection"]').click();await pause();assert.equal(d.querySelector('#welink-mcp-packageUrl').value,defaults.packageUrl);
 }finally{dom.window.close();}
});

test('test-message button requires a recipient and saved settings, prevents double sends and shows outcome',async()=>{
 const config={packageUrl:'https://example.test/pkg',indexUrl:'https://example.test/simple',insecureHosts:''};let sends=0,finish;
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/settings',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,options)=>{
  if(url==='/api/auto-ut/welink-mcp-settings/test'){sends++;assert.deepEqual(JSON.parse(options.body),{receiver:'w12345678'});return new Promise(resolve=>{finish=resolve;});}
  return {ok:true,status:200,json:async()=>url==='/api/auto-ut/welink-mcp-settings'?{config,defaults:config}:url==='/api/auto-ut/welink-settings'?{configured:true}:[]};
 };}});
 try{await pause();const d=dom.window.document;d.querySelector('[data-qw-drawer="connection"]').click();await pause();
  const button=d.querySelector('#welink-test-send'),receiver=d.querySelector('#welink-test-receiver');button.click();assert.equal(sends,0);assert.match(d.querySelector('#welink-test-result').textContent,/工号/);
  receiver.value='W12345678';d.querySelector('#welink-token').value='unsaved';button.click();assert.equal(sends,0);assert.match(d.querySelector('#welink-test-result').textContent,/先保存/);d.querySelector('#welink-token').value='';
  button.click();button.click();assert.equal(sends,1);assert.equal(button.disabled,true);
  finish({ok:true,status:200,json:async()=>({message:'MCP 已确认发送成功'})});await pause();assert.equal(button.disabled,false);assert.match(d.querySelector('#welink-test-result').textContent,/确认发送成功/);
  button.click();assert.equal(sends,2);finish({ok:false,status:502,json:async()=>({message:'测试消息发送未确认'})});await pause();assert.equal(sends,2);assert.match(d.querySelector('#welink-test-result').textContent,/未确认/);
 }finally{dom.window.close();}
});

test('CodeHub token settings saves and clears independently without displaying the secret',async()=>{
 let configured=false,writes=0;
 const dom=new JSDOM(html,{url:'http://localhost/#/automation/settings',runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.fetch=async(url,options)=>({ok:true,status:200,json:async()=>{if(url==='/api/automation/codehub-settings'){if(options?.method==='PUT'){assert.deepEqual(JSON.parse(options.body),{token:'test-token'});configured=true;writes++;}if(options?.method==='DELETE'){configured=false;writes++;}return{configured};}return [];}});}});
 try{await pause();const d=dom.window.document;d.querySelector('[data-qw-drawer="connection"]').click();await pause();assert.equal(d.querySelector('#codehub-clear').disabled,true);assert.equal(d.querySelector('#codehub-token').type,'password');d.querySelector('#codehub-token').value='test-token';d.querySelector('#codehub-save').click();await pause();assert.equal(configured,true);assert.equal(d.querySelector('#codehub-token').value,'');assert.equal(d.querySelector('#codehub-clear').disabled,false);assert.doesNotMatch(d.body.textContent,/test-token/);d.querySelector('#codehub-clear').click();await pause();assert.equal(configured,false);assert.equal(writes,2);}
 finally{dom.window.close();}
});
