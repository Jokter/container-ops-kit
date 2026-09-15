import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {browse} from '../src/modules/workspace/directories.js';
import {readConfig} from '../src/config.js';

test('directory API preserves the Java response contract, sorting and file filtering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ops-workspace-'));
  try {
    await mkdir(join(root, 'z-last'));
    await mkdir(join(root, 'A-first'));
    await writeFile(join(root, 'not-a-directory'), 'test');
    const result = await browse(join(root, '.'));
    assert.equal(result.current, root);
    assert.equal(result.parent, dirname(root));
    assert.equal(typeof result.writable, 'boolean');
    assert.deepEqual(result.directories.map(entry => entry.name), ['A-first', 'z-last']);
    assert.ok(result.directories.every(entry => entry.path.startsWith(root)));
    await assert.rejects(browse(join(root, 'missing')), {statusCode: 400});
    await assert.rejects(browse(join(root, 'not-a-directory')), {statusCode: 400});
  } finally {await rm(root, {recursive: true, force: true});}
});
test('blank path lists platform roots', async () => {
  const roots = await browse('  ');
  assert.equal(roots.current, '');
  assert.equal(roots.parent, '');
  assert.equal(roots.writable, false);
  assert.ok(roots.directories.length > 0);
});
test('configuration rejects loops, remote upstreams and invalid limits', () => {
  assert.equal(readConfig({}).legacyUrl, 'http://127.0.0.1:8081');
  assert.throws(() => readConfig({LEGACY_BACKEND_URL: 'http://127.0.0.1:8080'}));
  assert.throws(() => readConfig({LEGACY_BACKEND_URL: 'https://example.com'}));
  assert.throws(() => readConfig({LEGACY_BACKEND_URL: 'http://user:secret@localhost:8081'}));
  assert.throws(() => readConfig({PLATFORM_WORKERS: '0'}));
});
