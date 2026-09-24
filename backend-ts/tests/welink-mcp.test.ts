import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../src/platform/store.js';
import {WelinkMcp,confirmedWelinkResult,welinkMcpArgs} from '../src/modules/autout/welink-mcp.js';
import {WelinkSettings} from '../src/modules/autout/welink-settings.js';
const server=`process.stdout.write('Starting welink-msg stdio...\\n');const readline=require('node:readline');let initialized=false,calls=0;readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;
if(m.method==='initialize')result={protocolVersion:'2024-11-05'};
else if(m.method==='notifications/initialized'){initialized=true;return;}
else if(m.method==='tools/list')result={tools:[{name:'send_welink_message'}]};
else if(m.method==='tools/call'){calls++;const a=m.params.arguments;result={isError:!initialized||calls!==1||a.receiver!=='w00789509'||Object.keys(a).sort().join(',')!=='content,receiver'||a.content!=='test message'||process.env.WELINK_TOKEN!=='test-only-token',content:[{type:'text',text:JSON.stringify({status:'ok'})}]};}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`;
test('reference MCP flow tolerates startup banners, sends only content/receiver once and reads token from environment',async()=>{
 const client=new WelinkMcp(token=>spawn(process.execPath,['-e',server],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,WELINK_TOKEN:token}}),5000);
 await client.send('w00789509','test message','test-only-token');
});
test('MCP timeout and abort terminate without a second send',async()=>{
 let launches=0;const client=new WelinkMcp(()=>{launches++;return spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});},100);
 await assert.rejects(client.send('w00789509','test','test-only-token'),/超时/);assert.equal(launches,1);
 const controller=new AbortController();controller.abort();await assert.rejects(client.send('w00789509','test','test-only-token',controller.signal));assert.equal(launches,1);
});
test('MCP acknowledgement must explicitly confirm success',()=>{
 assert.equal(confirmedWelinkResult({isError:false,content:[{type:'text',text:'消息发送成功'}]}),true);
 for(const result of [{isError:true,content:[{type:'text',text:'消息发送成功'}]},{content:[{type:'text',text:'timeout'}]},{content:[{type:'text',text:'{"resultCode":"1"}'}]}])assert.equal(confirmedWelinkResult(result),false);
});
test('WeLink token is encrypted and can fall back to backend environment',()=>{
 const dir=mkdtempSync(join(tmpdir(),'welink-settings-')),store=new TaskStore(':memory:'),previous=process.env.WELINK_TOKEN;
 try{process.env.WELINK_TOKEN='environment-test';const settings=new WelinkSettings(store,join(dir,'key'));assert.equal(settings.token(),'environment-test');settings.save('saved-test');assert.equal(settings.token(),'saved-test');assert.ok(!JSON.stringify(store.getRecord('welink-settings','token')).includes('saved-test'));assert.deepEqual(settings.status(),{configured:true});settings.clear();assert.equal(settings.token(),'environment-test');}finally{if(previous===undefined)delete process.env.WELINK_TOKEN;else process.env.WELINK_TOKEN=previous;store.close();rmSync(dir,{recursive:true,force:true});}
});

test('stdio launcher reads private package locations from runtime configuration',()=>{
 assert.deepEqual(welinkMcpArgs({WELINK_MCP_PACKAGE:'https://packages.example.test/welink.tar.gz',WELINK_MCP_INDEX_URL:'https://index.example.test/simple',WELINK_MCP_INSECURE_HOSTS:'index.example.test,packages.example.test'}),['--index-url','https://index.example.test/simple','--allow-insecure-host','index.example.test','--allow-insecure-host','packages.example.test','--from','https://packages.example.test/welink.tar.gz','welink-msg','stdio']);
 assert.deepEqual(welinkMcpArgs({}),['--index-url','https://mirrors.tools.huawei.com/pypi/simple','--allow-insecure-host','mirrors.tools.huawei.com','--allow-insecure-host','cmc.centralrepo.rnd.huawei.com','--from','https://cmc.centralrepo.rnd.huawei.com/artifactory/product_generic/hw-generic_computing_mcp_server/servers/welink-msg/1.1.0/welink_msg-1.1.0.tar.gz','welink-msg','stdio']);
 assert.throws(()=>welinkMcpArgs({WELINK_MCP_PACKAGE:'file:///tmp/code'}),/地址无效/);
});

test('MCP acknowledgement accepts explicit ok responses and rejects ambiguous or contradictory success',()=>{
 for(const result of [
  {structuredContent:{status:'ok'}},
  {content:[{type:'text',text:'{"status": "ok"}'}]},
  {content:[{type:'text',text:'消息发送成功，接收者：w00789509'}]},
  {content:[{type:'text',text:'✅ 消息已成功发送！'}]}
 ])assert.equal(confirmedWelinkResult(result),true);
 for(const result of [
  {content:[{type:'text',text:'消息发送不成功'}]},
  {content:[{type:'text',text:'未确认发送成功'}]},
  {content:[{type:'text',text:'{"status":"ok","resultCode":1}'}]},
  {structuredContent:{status:'failed'},content:[{type:'text',text:'消息发送成功'}]},
  {content:[{type:'text',text:'消息发送成功'},{type:'text',text:'{"success":false}'}]}
 ])assert.equal(confirmedWelinkResult(result),false);
});

test('reference WELINK_MCP_UVX_ARGS overrides defaults while keeping the stdio executable fixed',()=>{
 const command=['uvx','--from','https://packages.example.test/welink.tar.gz','welink-msg','stdio'];
 assert.deepEqual(welinkMcpArgs({WELINK_MCP_UVX_ARGS:JSON.stringify(command)}),command.slice(1));
 assert.throws(()=>welinkMcpArgs({WELINK_MCP_UVX_ARGS:'not-json'}),/JSON/);
 assert.throws(()=>welinkMcpArgs({WELINK_MCP_UVX_ARGS:JSON.stringify(['sh','-c','echo secret'])}),/uvx/);
 assert.throws(()=>welinkMcpArgs({WELINK_MCP_UVX_ARGS:JSON.stringify(['uvx','--from','https://packages.example.test/a','--allow-insecure-host','welink-msg','stdio'])}),/缺少值/);
});

test('a tool error is not retried even if its content contains a success sentence',async()=>{
 let calls=0;const childSource=server.replace("result={isError:!initialized", "process.stderr.write('tool-call\\n');result={isError:true||!initialized");
 const client=new WelinkMcp(token=>{const child=spawn(process.execPath,['-e',childSource],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,WELINK_TOKEN:token}});child.stderr.on('data',chunk=>{calls+=String(chunk).split('tool-call').length-1;});return child;},5000);
 await assert.rejects(client.send('w00789509','test message','test-only-token'),/未返回明确/);assert.equal(calls,1);
});

test('saved MCP configuration persists, overrides environment args and never changes the token',()=>{
 const store=new TaskStore(':memory:'),settings=new WelinkSettings(store),previous=process.env.WELINK_MCP_UVX_ARGS;
 try{
  process.env.WELINK_MCP_UVX_ARGS=JSON.stringify(['uvx','--from','https://env.example.test/pkg','welink-msg','stdio']);
  assert.equal(settings.mcpStatus().config.packageUrl,'https://env.example.test/pkg');
  const config={packageUrl:'https://saved.example.test/pkg',indexUrl:'https://saved.example.test/simple',insecureHosts:'saved.example.test'};
  settings.saveMcp(config);
  assert.deepEqual(new WelinkSettings(store).mcpStatus().config,config);
  assert.ok(settings.mcpArgs().includes(config.packageUrl));
  assert.ok(!settings.mcpArgs().includes('https://env.example.test/pkg'));
  settings.clear();assert.deepEqual(settings.mcpStatus().config,config);
  assert.throws(()=>settings.saveMcp({...config,packageUrl:'file:///tmp/pkg'}));
  assert.throws(()=>settings.saveMcp({...config,indexUrl:'https://user:pass@example.test'}));
  assert.throws(()=>settings.saveMcp({...config,insecureHosts:'example.test --from evil'}));
  assert.deepEqual(settings.mcpStatus().config,config);
  settings.saveMcp(settings.mcpStatus().defaults);assert.deepEqual(settings.mcpArgs(),welinkMcpArgs({}));
 }finally{if(previous===undefined)delete process.env.WELINK_MCP_UVX_ARGS;else process.env.WELINK_MCP_UVX_ARGS=previous;store.close();}
});

test('test-message API validates recipient, sends once, blocks concurrent sends and reports uncertainty without retry',async()=>{
 const {default:Fastify}=await import('fastify');const {welinkSettingsRoutes}=await import('../src/modules/autout/welink-settings.js');
 const app=Fastify(),store=new TaskStore(':memory:'),previous=process.env.WELINK_TOKEN;
 let release:()=>void=()=>{},started:()=>void=()=>{},calls=0,fail=false;
 const inFlight=new Promise<void>(resolve=>{started=resolve;});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 process.env.WELINK_TOKEN='test-only-token';
 const config={packageUrl:'https://example.test/package',indexUrl:'https://example.test/simple',insecureHosts:''};new WelinkSettings(store).saveMcp(config);
 welinkSettingsRoutes(app,store,{send:async(receiver,content,token)=>{calls++;assert.equal(receiver,'w12345678');assert.match(content,/连接测试消息/);assert.equal(token,'test-only-token');started();await blocked;if(fail)throw Error('private server details');}});
 const url='/api/auto-ut/welink-mcp-settings/test';
 try{
  assert.equal((await app.inject({method:'POST',url,payload:{receiver:'invalid receiver'}})).statusCode,400);assert.equal(calls,0);
  assert.equal((await app.inject({method:'POST',url,payload:{receiver:'w12345678',content:'arbitrary'}})).statusCode,400);
  const first=app.inject({method:'POST',url,payload:{receiver:' W12345678 '}});await inFlight;
  assert.equal((await app.inject({method:'POST',url,payload:{receiver:'w12345678'}})).statusCode,409);assert.equal(calls,1);
  release();const result=await first;assert.equal(result.statusCode,200);assert.match(result.json().message,/确认发送成功/);assert.ok(!result.body.includes('test-only-token'));
  fail=true;const failed=await app.inject({method:'POST',url,payload:{receiver:'w12345678'}});assert.equal(failed.statusCode,502);assert.match(failed.json().message,/未确认/);assert.ok(!failed.body.includes('private server details'));assert.equal(calls,2);
  delete process.env.WELINK_TOKEN;assert.equal((await app.inject({method:'POST',url,payload:{receiver:'w12345678'}})).statusCode,400);assert.equal(calls,2);
 }finally{release();await app.close();store.close();if(previous===undefined)delete process.env.WELINK_TOKEN;else process.env.WELINK_TOKEN=previous;}
});
