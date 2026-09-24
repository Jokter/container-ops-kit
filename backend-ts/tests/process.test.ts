import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isBatchFile,runProcess,batchArgument,displayCommand} from '../src/infrastructure/process.js';

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


test('通知日志正文带引号，直接进程收到完整正文而非引号字符',async()=>{
 const text='UT 治理 MR 请检视。；仓库：SWMFrontendService；MR：https://example.invalid/merge_requests/1854';
 assert.equal(displayCommand(['welink-cli','im','send-to-user','--receiver','s00880288','--text',text]),'welink-cli im send-to-user --receiver s00880288 --text "'+text+'"');
 const result=await runProcess([process.execPath,'-e','console.log(JSON.stringify(process.argv.slice(1)))','--',text],process.cwd(),5000);
 assert.deepEqual(JSON.parse(result.output),[text]);
 assert.equal(batchArgument('UT 治理'),' ^"UT^ 治理^"'.trim());
 assert.ok(batchArgument('a&b').includes('^&'));
 assert.throws(()=>batchArgument('a\nb'),/换行/);
});
test('Windows 批处理转发保留空格、中文、URL 与特殊字符', {skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'welink quoting '));t.after(()=>rm(root,{recursive:true,force:true}));
 const helper=join(root,'args.cjs'),batch=join(root,'welink-cli.cmd');
 await writeFile(helper,'console.log(JSON.stringify(process.argv.slice(2)))');
 await writeFile(batch,'@echo off\r\n"'+process.execPath+'" "'+helper+'" %*\r\n');
 const args=['--text','UT 治理；MR：https://example.invalid/1854?a=1&b=2','a"b','C:\\test dir\\'];
 const result=await runProcess([batch,...args],root,5000);assert.equal(result.exitCode,0);assert.deepEqual(JSON.parse(result.output),args);
});

test('large pretty JSON is complete with MR capture limit; default truncation is explicit',async()=>{
 const command=[process.execPath,'-e',`console.log(JSON.stringify(Array.from({length:1400},(_,i)=>({id:i,body:'检视意见'.repeat(30)})),null,2))`];
 const small=await runProcess(command,process.cwd(),5000);
 assert.equal(small.exitCode,0);assert.equal(small.outputTruncated,true);assert.equal(small.output.length,120000);assert.ok(small.outputChars!>120000);assert.throws(()=>JSON.parse(small.output));
 const full=await runProcess(command,process.cwd(),5000,undefined,undefined,undefined,undefined,8*1024*1024);
 assert.equal(full.outputTruncated,false);const list=JSON.parse(full.output);assert.equal(list.length,1400);assert.equal(list[1399].body,'检视意见'.repeat(30));assert.equal(full.outputChars,full.output.length);
});
