import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findGitBash,gitBashInvocation,jsExecutionCommand} from '../src/modules/autout/js-shell.js';
import {runProcess} from '../src/infrastructure/process.js';

test('JS Windows 定位 Git Bash，支持自定义路径，缺失时不使用 WSL',async()=>{
 const bash='D:\\Git Tools\\bin\\bash.exe';
 assert.equal(await findGitBash({Path:'D:\\Git Tools\\cmd;C:\\Windows\\System32'},async p=>p===bash),bash);
 assert.equal(await findGitBash({ProgramFiles:'C:\\Program Files'},async p=>p==='C:\\Program Files\\Git\\bin\\bash.exe'),'C:\\Program Files\\Git\\bin\\bash.exe');
 assert.equal(await findGitBash({AUTO_UT_GIT_BASH:bash},async p=>p===bash),bash);
 await assert.rejects(findGitBash({AUTO_UT_GIT_BASH:'bash.exe'},async()=>true),/绝对路径/);
 await assert.rejects(findGitBash({AUTO_UT_GIT_BASH:bash},async()=>false),/绝对路径/);
 await assert.rejects(findGitBash({PATH:'C:\\Windows\\System32'},async p=>p==='C:\\Windows\\System32\\bash.exe'),/未找到 Git Bash/);
});

test('Git Bash 登录后显式 cd website，Windows Jest 报告路径保持可用',async()=>{
 const bash='C:\\Program Files\\Git\\bin\\bash.exe',dir='D:\\项目 空格\\website';
 const mvn=gitBashInvocation(bash,['mvn','clean','install'],dir);
 assert.deepEqual(mvn.slice(0,3),[bash,'--login','-c']);
 assert.deepEqual(mvn.slice(4),['ops-studio-js','D:/项目 空格/website','mvn','clean','install']);
 const npm=gitBashInvocation(bash,['npm','run','test','--','--outputFile=D:\\日志 空格\\jest.json'],dir);
 assert.equal(npm.at(-1),'--outputFile=D:/日志 空格/jest.json');
 assert.deepEqual(await jsExecutionCommand(['mvn','clean','install'],'/repo/website','linux'),['mvn','clean','install']);
});

test('Bash 实际执行验证目录、特殊字符参数与失败退出码', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'js bash-')),dir=join(root,"中文 $x ' quote; website");await mkdir(dir);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const args=['空 格',"single'quote",'$(exit 9)','a&b','--outputFile=C:/日志 空格/result.json'];
 const command=gitBashInvocation('/bin/bash',[process.execPath,'-e','console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}))','--',...args],dir);
 const result=await runProcess(command,root,5000);
 assert.equal(result.exitCode,0);
 const row=result.output.split('\n').find(line=>line.startsWith('{'));assert.ok(row);
 assert.deepEqual(JSON.parse(row),{cwd:dir,args});assert.match(result.output,/Ops Studio JS.*cwd=/);
 const failed=await runProcess(gitBashInvocation('/bin/bash',[process.execPath,'-e','process.exit(7)'],dir),root,5000);assert.equal(failed.exitCode,7);
 const missing=await runProcess(gitBashInvocation('/bin/bash',[process.execPath,'-e','console.log("SHOULD_NOT_RUN")'],join(root,'missing')),root,5000);assert.notEqual(missing.exitCode,0);assert.doesNotMatch(missing.output,/SHOULD_NOT_RUN/);
});
