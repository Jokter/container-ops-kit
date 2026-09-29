import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {discoverUvRuntime,welinkMcpEnvironment} from '../src/infrastructure/uv-runtime.js';
import {makeWorkspace,inWorkspace} from '../src/auth/workspace.js';

test('uv discovers machine cache and Python paths, honoring explicit overrides',async()=>{
 const calls:string[][]=[],root=resolve('runtime-fixture');
 const result=await discoverUvRuntime({},async args=>{calls.push([...args]);return join(root,args[0]!)+'\n';});
 assert.deepEqual(calls,[['cache','dir'],['python','dir']]);assert.deepEqual(result,{UV_CACHE_DIR:join(root,'cache'),UV_PYTHON_INSTALL_DIR:join(root,'python')});
 const custom=await discoverUvRuntime({UV_CACHE_DIR:'custom-cache',UV_PYTHON_INSTALL_DIR:'custom-python'},async()=>{throw Error('must not probe');});assert.equal(custom.UV_CACHE_DIR,resolve('custom-cache'));
 await assert.rejects(discoverUvRuntime({},async()=>{throw Error('private response');}),error=>error instanceof Error&&/UV_CACHE_DIR/.test(error.message)&&!/private response/.test(error.message));
 await assert.rejects(discoverUvRuntime({},async()=>'/path\nunexpected output'),/无法读取机器/);
});
test('MCP shares only runtime directories while retaining separate user homes and stripped credentials',async t=>{
 const root=await mkdtemp(join(tmpdir(),'uv-isolated-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=makeWorkspace('alice',root,join(root,'work'),'/usr1/wytest'),b=makeWorkspace('bob',root,join(root,'work'),'/usr1/wytest');
 const runtime={UV_CACHE_DIR:join(root,'machine-cache'),UV_PYTHON_INSTALL_DIR:join(root,'machine-python')};
 const previous=process.env.WELINK_TOKEN;process.env.WELINK_TOKEN='host-token';
 try{const [alice,bob]=await Promise.all([a,b].map(w=>inWorkspace(w,()=>welinkMcpEnvironment(async()=>runtime))));
  assert.ok(alice&&bob);
  for(const env of [alice,bob]){assert.equal(env.UV_CACHE_DIR,runtime.UV_CACHE_DIR);assert.equal(env.UV_PYTHON_INSTALL_DIR,runtime.UV_PYTHON_INSTALL_DIR);assert.equal(env.WELINK_TOKEN,undefined);}
  assert.equal(alice.HOME,a.home);assert.equal(alice.USERPROFILE,a.home);assert.equal(bob.HOME,b.home);assert.notEqual(alice.APPDATA,bob.APPDATA);assert.notEqual(alice.XDG_CONFIG_HOME,bob.XDG_CONFIG_HOME);
 }finally{if(previous===undefined)delete process.env.WELINK_TOKEN;else process.env.WELINK_TOKEN=previous;}
});
