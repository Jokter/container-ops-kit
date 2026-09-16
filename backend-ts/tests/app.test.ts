import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {createApp} from '../src/app.js';
import type {Task} from '../../shared/contracts.js';

test('native service exposes health and validates environment API', async t => {
  const app = await createApp({port: 8080,database: ':memory:',workers:1,taskTimeoutMs:5000});
  t.after(()=>app.close());
  assert.deepEqual((await app.inject('/api/health')).json(), {status: 'UP'});
  assert.equal((await app.inject('/api/platform/health')).json().migrationStage,'complete');
  assert.equal((await app.inject('/api/auto-ut/workspace-directories')).statusCode, 200);
  assert.equal((await app.inject('/api/release-versions')).json().length,2);
  assert.equal((await app.inject({method:'POST',url:'/api/environments',payload:{}})).statusCode,400);
  assert.equal((await app.inject({method: 'DELETE', url: '/api/auto-ut/schedule'})).statusCode, 204);
});

test('environment CRUD persists the existing API contract and optimistic revision', async t => {
  const app=await createApp({port:8080,database:':memory:',workers:1,taskTimeoutMs:5000});t.after(()=>app.close());
  const base={releaseVersionId:1,type:'CONTAINER',name:'OM 测试环境',host:'127.0.0.1',sshPort:22,password:'sop-test',rootPassword:'root-test',workDirectory:null,architecture:'X86_64',businessPlaneUrl:null,businessPlaneUser:null,businessPlanePassword:null,managementPlaneUrl:null,managementPlaneUser:null,managementPlanePassword:null,version:null};
  const created=await app.inject({method:'POST',url:'/api/environments',payload:base});assert.equal(created.statusCode,201);const value=created.json();assert.equal(value.releaseVersion.code,'R27C10');assert.equal(value.version,0);
  const stale=await app.inject({method:'PUT',url:`/api/environments/${value.id}`,payload:{...base,name:'更新',version:1}});assert.equal(stale.statusCode,409);
  const updated=await app.inject({method:'PUT',url:`/api/environments/${value.id}`,payload:{...base,name:'更新',version:0}});assert.equal(updated.statusCode,200);assert.equal(updated.json().version,1);assert.equal(updated.json().name,'更新');
  assert.equal((await app.inject(`/api/environments/${value.id}`)).json().rootPassword,'root-test');assert.equal((await app.inject({method:'DELETE',url:`/api/environments/${value.id}`})).statusCode,204);assert.equal((await app.inject(`/api/environments/${value.id}`)).statusCode,404);
});

test('native task API validates input, persists lifecycle and replays SSE', async t => {
  const app = await createApp({port: 8080,database: ':memory:',workers:1,taskTimeoutMs:5000});
  t.after(() => app.close());
  assert.equal((await app.inject({method: 'POST', url: '/api/platform/tasks', payload: {kind: 'shell', command: 'anything'}})).statusCode, 400);
  assert.equal((await app.inject({method: 'POST', url: '/api/platform/tasks', headers: {origin: 'https://example.com'}, payload: {kind: 'workspace-inspect', path: tmpdir()}})).statusCode, 403);
  assert.equal((await app.inject({url: '/api/platform/tasks', headers: {host: 'evil.example'}})).statusCode, 403);
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
