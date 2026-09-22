import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Windows 启动按 lock 校验依赖且日志由 cmd 合并 stderr',async()=>{
 const [start,runner,installer]=await Promise.all([
  readFile('start.bat','utf8'),readFile('scripts/run-logged.ps1','utf8'),readFile('scripts/install-locked.mjs','utf8')
 ]);
 assert.doesNotMatch(start,/npm ci/);
 assert.match(start,/install-locked\.mjs \./);
 assert.match(start,/install-locked\.mjs frontend/);
 assert.match(runner,/\$executionCommand \+ ' 2>&1'/);
 assert.match(installer,/installation skipped/);
 assert.match(installer,/without deleting node_modules/);
});
