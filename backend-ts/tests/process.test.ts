import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isBatchFile,runProcess} from '../src/infrastructure/process.js';

test('Windows 批处理程序通过 shell 启动',()=>{
 assert.equal(isBatchFile('C:\\tools\\mvn.cmd','win32'),true);
 assert.equal(isBatchFile('codecovcli.BAT','win32'),true);
 assert.equal(isBatchFile('mvn.exe','win32'),false);
 assert.equal(isBatchFile('/usr/bin/mvn','linux'),false);
});

test('带输入的 RPC 子进程保持 stdin 打开直到终止事件',async t=>{
 const root=await mkdtemp(join(tmpdir(),'process-rpc-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const helper=join(root,'rpc-helper.mjs');await writeFile(helper,`import readline from 'node:readline';\nlet ended=false;process.stdin.once('end',()=>ended=true);readline.createInterface({input:process.stdin}).once('line',()=>setTimeout(()=>console.log(ended?'CLOSED':'OPEN'),50));\n`,'utf8');
 const result=await runProcess([process.execPath,helper],root,5000,undefined,line=>line==='OPEN','prompt\n');
 assert.equal(result.exitCode,0);assert.match(result.output,/OPEN/);assert.doesNotMatch(result.output,/CLOSED/);
});

test('已取消信号不会启动子进程',async t=>{
 const root=await mkdtemp(join(tmpdir(),'process-abort-'));t.after(()=>rm(root,{recursive:true,force:true}));const abort=new AbortController();abort.abort();
 await assert.rejects(runProcess([process.execPath,'-e','setInterval(()=>{},1000)'],root,5000,undefined,undefined,undefined,abort.signal),{name:'AbortError'});
});
