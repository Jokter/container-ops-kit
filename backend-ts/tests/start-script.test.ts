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

test('start.bat 内嵌唯一清理逻辑，兼容入口和端口参数一致',async()=>{
 const start=await readFile('start.bat','utf8'),compat=await readFile('scripts/stop-previous.ps1','utf8');
 const marker='# BEGIN EMBEDDED PROCESS CLEANUP';
 const offset=start.lastIndexOf(marker),script=start.slice(offset+marker.length);
 assert.ok(offset>start.lastIndexOf('exit /b 1'));
 assert.match(script,/^\s*param\(/);
 assert.match(script,/\[int\]\$BackendPort = 8080/);
 assert.match(script,/\[int\]\$FrontendPort = 5173/);
 assert.match(compat,/LastIndexOf\(\$marker\)/);
 assert.doesNotMatch(compat,/taskkill/);
 assert.match(start,/--port %FRONTEND_PORT% --strictPort/);
 // Exercise the actual legacy command patterns: generic Vite/host arguments
 // and another checkout's absolute script must not establish ownership.
 const legacy=script.slice(script.indexOf('function Test-LegacyPortOwner'),script.indexOf('function Stop-VerifiedProcess'));
 const patterns=[...legacy.matchAll(/\$line -match '(\(\?i\).*?)'/g)].map(m=>new RegExp(m[1]!.replace('(?i)',''),'i'));
 assert.equal(patterns.length,2);
 assert.ok(patterns[0]!.test('node "dist\\backend-ts\\src\\main.js"'));
 assert.ok(patterns[1]!.test('node .\\node_modules\\vite\\bin\\vite.js --host 127.0.0.1'));
 for(const command of ['node other.js --host 127.0.0.1','node C:\\another\\node_modules\\vite\\bin\\vite.js','node C:\\another\\dist\\backend-ts\\src\\main.js'])assert.ok(patterns.every(pattern=>!pattern.test(command)));
});
