import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLoggedProcess,redactDiagnostic,redactJsonDiagnostic} from '../src/modules/autout/diagnostics.js';

test('完整命令输出保留尾部、区分输出流、重试不覆盖并记录退出码和耗时',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ut-diagnostic-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const command=[process.execPath,'-e','console.log("x".repeat(130000)); console.error("FINAL_ERROR"); process.exitCode=1'];
 const first=await runLoggedProcess(command,root,10000,join(root,'test.log'));
 assert.equal(first.exitCode,1);assert.equal(first.outputTruncated,true);
 await runLoggedProcess([process.execPath,'-e','console.log("second")'],root,10000,join(root,'test.log'));
 const logs=(await readdir(root)).filter(name=>name.endsWith('.log'));assert.equal(logs.length,2);
 const contents=await Promise.all(logs.map(file=>readFile(join(root,file),'utf8')));assert.ok(contents.some(text=>text.length>130000&&text.includes('stderr FINAL_ERROR')));
 const events=(await readFile(join(root,'diagnostics.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.length,4);assert.equal(events[1].exitCode,1);assert.ok(events[1].durationMs>=0);assert.equal(events[1].captureTruncated,true);assert.equal(events[0].directory,root);
});
test('诊断脱敏保留 JSON 结构，不记录标准输入；启动失败有错误记录',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ut-redact-')),previous=process.env.TEST_DIAGNOSTIC_TOKEN;process.env.TEST_DIAGNOSTIC_TOKEN='example-private-key';t.after(async()=>{if(previous===undefined)delete process.env.TEST_DIAGNOSTIC_TOKEN;else process.env.TEST_DIAGNOSTIC_TOKEN=previous;await rm(root,{recursive:true,force:true});});
 const text='https://user:pass@example.test password=secret token=abc Bearer abcdef example-private-key';const redacted=redactDiagnostic(text);assert.doesNotMatch(redacted,/user:pass|=secret|=abc|Bearer abcdef|example-private-key/);
 const json=JSON.parse(redactJsonDiagnostic(JSON.stringify({tests:2,token:'sensitive',details:'password=secret'})));assert.equal(json.tests,2);assert.equal(json.token,'[REDACTED]');assert.doesNotMatch(json.details,/secret/);
 await runLoggedProcess([process.execPath,'-e','console.log(process.env.TEST_DIAGNOSTIC_TOKEN)'],root,10000,join(root,'test.log'),undefined,'unlogged-stdin');
 await assert.rejects(runLoggedProcess([join(root,'missing-program')],root,10000,join(root,'missing.log')));
 const all=(await Promise.all((await readdir(root)).map(name=>readFile(join(root,name),'utf8')))).join('\n');assert.doesNotMatch(all,/example-private-key|unlogged-stdin/);assert.match(all,/command_error/);
});
