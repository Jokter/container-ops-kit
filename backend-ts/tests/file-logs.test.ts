import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileLogs} from '../src/infrastructure/file-logs.js';

test('task logs use fixed JSONL paths and redact credentials',async t=>{
  const root=await mkdtemp(join(tmpdir(),'container-ops-logs-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const logs=new FileLogs(root);
  logs.task('deployment','task/unsafe',{message:'connection password=visible failed',password:'secret',nested:{rootPassword:'root-secret'},url:'https://user:pass@example.test/path'});
  const line=await readFile(join(root,'deployment','task_unsafe.jsonl'),'utf8');
  const value=JSON.parse(line);
  assert.equal(value.password,'[REDACTED]');
  assert.equal(value.nested.rootPassword,'[REDACTED]');
  assert.equal(value.url,'https://user:[REDACTED]@example.test/path');
  assert.equal(value.message,'connection password=[REDACTED] failed');
});
