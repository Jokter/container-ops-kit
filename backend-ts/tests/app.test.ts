import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {createApp} from '../src/app.js';
import type {Task} from '../../shared/contracts.js';

test('gateway preserves old API payloads, status codes, uploads, queries and SSE', async t => {
  let calls = 0, ready = true;
  const upstream = createServer(async (req, res) => {
    calls++;
    if (req.url === '/api/health') {res.writeHead(ready ? 200 : 503, {'content-type': 'application/json'}); res.end(JSON.stringify({status: ready ? 'UP' : 'DOWN'})); return;}
    if (req.url === '/api/build-tasks/id/events') {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(`id: 2\ndata: ${JSON.stringify({message: '中文日志', cursor: req.headers['last-event-id']})}\n\n`);
      setTimeout(() => res.end('id: 3\ndata: {"done":true}\n\n'), 50);
      return;
    }
    if (req.url === '/api/deployment-tasks') {res.writeHead(503, {'content-type': 'application/json'}); res.end('{"message":"busy"}'); return;}
    if (req.url === '/api/auto-ut/schedule' && req.method === 'DELETE') {res.writeHead(204); res.end(); return;}
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.writeHead(201, {'content-type': 'application/json'});
    res.end(JSON.stringify({method: req.method, url: req.url, contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString()}));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const app = await createApp({port: 8080, legacyUrl: `http://127.0.0.1:${address.port}`, database: ':memory:', workers: 1, taskTimeoutMs: 5000});
  t.after(async () => {await app.close(); await new Promise<void>(resolve => upstream.close(() => resolve()));});

  assert.deepEqual((await app.inject('/api/health')).json(), {status: 'UP'});
  ready = false;
  assert.equal((await app.inject('/api/health')).statusCode, 503);
  assert.equal((await app.inject('/api/platform/health')).statusCode, 200);
  const before = calls;
  assert.equal((await app.inject('/api/auto-ut/workspace-directories')).statusCode, 200);
  assert.equal(calls, before, 'directory browsing must be served natively');

  const upload = '--boundary\r\nContent-Disposition: form-data; name="report"; filename="ut.csv"\r\nContent-Type: text/csv\r\n\r\n服务,结果\r\nFM,失败\r\n--boundary--\r\n';
  const result = await app.inject({method: 'POST', url: '/api/auto-ut/scan?username=test', headers: {'content-type': 'multipart/form-data; boundary=boundary'}, payload: upload});
  assert.equal(result.statusCode, 201);
  assert.equal(result.json().body, upload);
  assert.equal(result.json().url, '/api/auto-ut/scan?username=test');
  assert.equal(result.json().contentType, 'multipart/form-data; boundary=boundary');
  const update = await app.inject({method: 'PUT', url: '/api/environments/42', payload: {name: '测试', rootPassword: 'test-only'}});
  assert.deepEqual(JSON.parse(update.json().body), {name: '测试', rootPassword: 'test-only'});
  assert.equal((await app.inject({method: 'DELETE', url: '/api/auto-ut/schedule'})).statusCode, 204);
  const attempts = calls;
  assert.equal((await app.inject({method: 'POST', url: '/api/deployment-tasks', payload: {}})).statusCode, 503);
  assert.equal(calls, attempts + 1, 'a mutating request must never be retried');
  const events = await app.inject({url: '/api/build-tasks/id/events', headers: {'last-event-id': '1'}});
  assert.match(events.body, /中文日志/);
  assert.match(events.body, /"cursor":"1"/);
  assert.match(events.body, /id: 3/);
});

test('native task API validates input, persists lifecycle and replays SSE', async t => {
  const app = await createApp({port: 8080, legacyUrl: 'http://127.0.0.1:1', database: ':memory:', workers: 1, taskTimeoutMs: 5000});
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

test('real HTTP SSE is streamed before upstream completion and shutdown releases connections', {timeout: 5000}, async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    res.write('id: 1\ndata: {"message":"live"}\n\n');
    // Intentionally never finish: the gateway must stream now, and shut down without waiting forever.
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const app = await createApp({port: 8080, legacyUrl: `http://127.0.0.1:${address.port}`, database: ':memory:', workers: 1, taskTimeoutMs: 5000});
  try {
    const base = await app.listen({port: 0, host: '127.0.0.1'});
    const response = await fetch(`${base}/api/build-tasks/id/events`, {signal: AbortSignal.timeout(2000)});
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /live/);
    await app.close();
    await reader.cancel().catch(() => {});
  } finally {
    upstream.closeAllConnections();
    await app.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
