import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../src/platform/store.js';
import {TaskRunner} from '../src/platform/tasks.js';
import {terminal} from '../../shared/contracts.js';

test('task/event state persists; restart interrupts unfinished tasks without retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ops-store-'));
  try {
    const db = join(root, 'tasks.sqlite');
    const first = new TaskStore(db);
    const running = first.create({kind: 'workspace-inspect', path: root});
    first.record(running.id, 'RUNNING', '扫描');
    const done = first.create({kind: 'workspace-inspect', path: root});
    first.record(done.id, 'RUNNING', '开始');
    first.record(done.id, 'SUCCEEDED', '完成');
    const cursor = first.events(running.id)[0]!.sequence;
    first.close();
    const restored = new TaskStore(db);
    try {
      restored.interruptUnfinished();
      assert.equal(restored.get(running.id)?.status, 'INTERRUPTED');
      assert.equal(restored.get(done.id)?.status, 'SUCCEEDED');
      assert.equal(restored.record(done.id, 'FAILED', '迟到事件'), undefined);
      assert.deepEqual(restored.events(running.id, cursor).map(event => event.status), ['RUNNING', 'INTERRUPTED']);
      assert.equal(restored.next(), undefined);
    } finally {restored.close();}
  } finally {await rm(root, {recursive: true, force: true});}
});

async function waitDone(store: TaskStore, id: string) {
  for (let i = 0; i < 200; i++) {
    const task = store.get(id)!;
    if (terminal(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('task did not finish');
}

test('duplicate backend cannot open the same database or interrupt active tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ops-exclusive-'));
  const filename = join(root, 'tasks.sqlite');
  const first = new TaskStore(filename);
  try {
    const task = first.create({kind: 'workspace-inspect', path: root});
    first.record(task.id, 'RUNNING', 'started');
    assert.throws(() => new TaskStore(filename), /locked/);
    assert.equal(first.get(task.id)?.status, 'RUNNING');
  } finally {first.close(); await rm(root, {recursive: true, force: true});}
});

test('isolated workers complete read-only jobs and report invalid workspace failures', async () => {
  const store = new TaskStore(':memory:');
  const runner = new TaskRunner(store, 1, 5000);
  try {
    const ok = runner.submit({kind: 'workspace-inspect', path: tmpdir()});
    assert.equal((await waitDone(store, ok.id)).status, 'SUCCEEDED');
    const bad = runner.submit({kind: 'workspace-inspect', path: join(tmpdir(), 'not-exist-' + ok.id)});
    assert.equal((await waitDone(store, bad.id)).status, 'FAILED');
    assert.equal(store.events(ok.id).at(-1)?.status, 'SUCCEEDED');
  } finally {await runner.close(); store.close();}
});

test('cancel is terminal for both running and queued jobs', async () => {
  const store = new TaskStore(':memory:');
  const runner = new TaskRunner(store, 1, 5000);
  try {
    const first = runner.submit({kind: 'workspace-inspect', path: tmpdir()});
    const second = runner.submit({kind: 'workspace-inspect', path: tmpdir()});
    runner.cancel(second.id);
    runner.cancel(first.id);
    await runner.close();
    assert.equal(store.get(first.id)?.status, 'CANCELLED');
    assert.equal(store.get(second.id)?.status, 'CANCELLED');
  } finally {await runner.close(); store.close();}
});

test('worker deadline terminates the task and does not retry', async () => {
  const store = new TaskStore(':memory:');
  const runner = new TaskRunner(store, 1, 1);
  try {
    const task = runner.submit({kind: 'workspace-inspect', path: tmpdir()});
    assert.equal((await waitDone(store, task.id)).status, 'FAILED');
    assert.match(store.events(task.id).at(-1)!.message, /超时/);
    assert.equal(store.next(), undefined);
  } finally {await runner.close(); store.close();}
});
