import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {readConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import type {Task} from '../../shared/contracts.js';

test('native service exposes health and validates environment API', async t => {
  const app = await createApp({...readConfig({}),port: 8080,database: ':memory:',workers:1,taskTimeoutMs:5000});
  t.after(()=>app.close());
  assert.deepEqual((await app.inject('/api/health')).json(), {status: 'UP'});
  assert.equal((await app.inject('/api/platform/health')).json().migrationStage,'complete');
  assert.equal((await app.inject('/api/auto-ut/workspace-directories')).statusCode, 200);
  assert.equal((await app.inject('/api/release-versions')).json().length,2);
  assert.equal((await app.inject({method:'POST',url:'/api/environments',payload:{}})).statusCode,400);
  assert.equal((await app.inject({method: 'DELETE', url: '/api/auto-ut/schedule'})).statusCode, 204);
});

test('environment CRUD persists the existing API contract and optimistic revision', async t => {
  const app=await createApp({...readConfig({}),port:8080,database:':memory:',workers:1,taskTimeoutMs:5000});t.after(()=>app.close());
  const base={releaseVersionId:1,type:'CONTAINER',name:'OM 测试环境',host:'127.0.0.1',sshPort:22,password:'sop-test',rootPassword:'root-test',workDirectory:null,architecture:'X86_64',businessPlaneUrl:null,businessPlaneUser:null,businessPlanePassword:null,managementPlaneUrl:null,managementPlaneUser:null,managementPlanePassword:null,version:null};
  const created=await app.inject({method:'POST',url:'/api/environments',payload:base});assert.equal(created.statusCode,201);const value=created.json();assert.equal(value.releaseVersion.code,'R27C10');assert.equal(value.version,0);
  const stale=await app.inject({method:'PUT',url:`/api/environments/${value.id}`,payload:{...base,name:'更新',version:1}});assert.equal(stale.statusCode,409);
  const updated=await app.inject({method:'PUT',url:`/api/environments/${value.id}`,payload:{...base,name:'更新',version:0}});assert.equal(updated.statusCode,200);assert.equal(updated.json().version,1);assert.equal(updated.json().name,'更新');
  assert.equal((await app.inject(`/api/environments/${value.id}`)).json().rootPassword,'root-test');assert.equal((await app.inject({method:'DELETE',url:`/api/environments/${value.id}`})).statusCode,204);assert.equal((await app.inject(`/api/environments/${value.id}`)).statusCode,404);
});

test('native task API validates input, persists lifecycle and replays SSE', async t => {
  const app = await createApp({...readConfig({}),port: 8080,database: ':memory:',workers:1,taskTimeoutMs:5000});
  t.after(() => app.close());
  assert.equal((await app.inject({method: 'POST', url: '/api/platform/tasks', payload: {kind: 'shell', command: 'anything'}})).statusCode, 400);
  assert.equal((await app.inject('/api/platform/tasks/not-a-uuid')).statusCode, 400);
  assert.equal((await app.inject('/api/platform/tasks/00000000-0000-4000-8000-000000000000')).statusCode, 404);
  const created = await app.inject({method: 'POST', url: '/api/platform/tasks', payload: {kind: 'workspace-inspect', path: tmpdir()}});
  assert.equal(created.statusCode, 202);
  const task = created.json<Task>();
  const events = await app.inject(`/api/platform/tasks/${task.id}/events`);
  assert.match(events.headers['content-type']!, /text\/event-stream/);
  assert.match(events.body, /SUCCEEDED/);
  const ids = [...events.body.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]));
  const replay = await app.inject({url: `/api/platform/tasks/${task.id}/events`, headers: {'last-event-id': String(ids.at(-2))}});
  assert.equal([...replay.body.matchAll(/^id: /gm)].length, 1);
  assert.equal((await app.inject(`/api/platform/tasks/${task.id}`)).json<Task>().status, 'SUCCEEDED');
  const cancelled = await app.inject({method: 'POST', url: `/api/platform/tasks/${task.id}/cancel`});
  assert.equal(cancelled.json<Task>().status, 'SUCCEEDED', 'cancel cannot rewrite a terminal result');
  assert.equal((await app.inject(`/api/platform/tasks/${task.id}/events?afterSequence=-1`)).statusCode, 400);
});

test('MR settings API persists roles and validates controls',async t=>{
 const app=await createApp({...readConfig({}),database:':memory:',workers:1,taskTimeoutMs:5000});t.after(()=>app.close());
 const config=(await app.inject('/api/auto-ut/mr-settings')).json();
 config.roles={reviewers:['r123'],approvers:['a123'],assignees:['m123']};config.repositories=[{repository:'Demo',roles:{reviewers:['r456']}}];
 assert.equal((await app.inject({method:'PUT',url:'/api/auto-ut/mr-settings',payload:config})).statusCode,200);
 assert.deepEqual((await app.inject('/api/auto-ut/mr-settings')).json().roles,config.roles);
 assert.equal((await app.inject({method:'PUT',url:'/api/auto-ut/mr-settings',payload:{...config,maxRepairRounds:0}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/auto-ut/tasks/missing/mr-control',payload:{action:'force-merge'}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/auto-ut/tasks/missing/mr-control',payload:{action:'check'}})).statusCode,404);
});


test('LAN and other browser origins reach environment APIs without a source restriction', async t => {
  const app = await createApp({...readConfig({}), database: ':memory:', workers: 1, taskTimeoutMs: 5000});
  t.after(() => app.close());
  for (const headers of [
    {host: '10.189.209.20:5173', origin: 'http://10.189.209.20:5173', 'sec-fetch-site': 'same-origin'},
    {host: 'localhost:8080', origin: 'http://10.189.209.20:5173', 'sec-fetch-site': 'same-origin'},
    {host: 'ops.example:5173', origin: 'https://example.com', 'sec-fetch-site': 'cross-site'},
  ]) {
    assert.equal((await app.inject({url: '/api/environments', headers})).statusCode, 200);
    const result = await app.inject({method: 'POST', url: '/api/environments/999999/connection-test', headers, payload: {user: 'SOPUSER'}});
    assert.equal(result.statusCode, 404);
    assert.equal(result.json().message, '环境不存在');
    assert.equal((await app.inject({method: 'POST', url: '/api/environments', headers, payload: {}})).statusCode, 400);
  }
});
