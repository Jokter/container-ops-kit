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
