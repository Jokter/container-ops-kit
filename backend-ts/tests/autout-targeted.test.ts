import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoUtService,type AutoUtTask} from '../src/modules/autout/autout.js';
import {readUtXml,utRegressionPassed} from '../src/modules/autout/governance.js';
import {mergeTargetedEvidence,targetedTestCommand} from '../src/modules/autout/targeted-tests.js';
import {TaskStore} from '../src/platform/store.js';

const evidence=(classes:Record<string,string>)=>readUtXml(Object.entries(classes).map(([name,body])=>({path:`service/target/surefire-reports/TEST-${name}.xml`,content:`<testsuite name="${name}">${body}</testsuite>`})));
const ok='<testcase name="works"/>';
function task(root:string,id='targeted-task'):AutoUtTask{return{id,repository:'Demo',username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'fix',workspaceRoot:root,executionMode:'AUTOMATIC',status:'REPAIRING',nextStage:'REPAIR',progress:45,attempts:1,message:'',pullRequestUrl:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reportedFailedTests:1,lineGoal:.8,branchGoal:.7,history:[],liveEvents:[],liveSequence:0};}

test('局部 Maven 命令不 clean，去重选择类并兼容无匹配测试的兄弟模块',()=>{
 const command=targetedTestCommand(['mvn','-s','.ci/settings.xml','clean','test','-Djacoco.skip=true'],['a.ATest','a.ATest','b.BTest']);
 assert.deepEqual(command,['mvn','-s','.ci/settings.xml','test','-Djacoco.skip=true','-Dtest=a.ATest,b.BTest','-Dsurefire.failIfNoSpecifiedTests=false']);
 assert.throws(()=>targetedTestCommand(['mvn','test'],[]));
 assert.throws(()=>targetedTestCommand(['mvn','test'],['*']));
});
test('局部报告保留其他模块证据，但拒绝零匹配、删用例、跳过和失败退出码',()=>{
 const before=evidence({'a.ATest':ok,'b.BTest':ok}),partial=evidence({'a.ATest':ok+'<testcase name="added"/>'});
 const merged=mergeTargetedEvidence(before,partial,['a.ATest'],0);
 assert.equal(merged.tests,3);assert.equal(utRegressionPassed(before,merged,0),true);
 assert.equal(utRegressionPassed(before,partial,0),false);
 for(const [current,code] of [[evidence({}),0],[evidence({'a.ATest':'<testcase name="added"/>'}),0],[evidence({'a.ATest':'<testcase name="works"><skipped/></testcase>'}),0],[partial,1]] as const)assert.throws(()=>mergeTargetedEvidence(before,current,['a.ATest'],code));
});
test('局部验证删除旧报告，使用实际测试包名；最终仍执行全量 clean test',async t=>{
 const root=await mkdtemp(join(tmpdir(),'targeted-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root);
 t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});
 const before=evidence({'a.ATest':ok,'b.BTest':ok});value.governance={mode:'SUPPLEMENT',coverageLow:true,maxClasses:5,baseline:before};
 const file='service/src/test/java/a/ATest.java',reports=join(root,'service/target/surefire-reports');
 await mkdir(join(root,'service/src/test/java/a'),{recursive:true});await writeFile(join(root,file),'package a; class ATest { @Test void works() {} }');
 await mkdir(reports,{recursive:true});await writeFile(join(reports,'TEST-old.xml'),'<testsuite/>');
 const calls:string[][]=[];
 service['command']=async(_task,command)=>{calls.push(command);await assert.rejects(readFile(join(reports,'TEST-old.xml')));await writeFile(join(reports,'TEST-a.ATest.xml'),'<testsuite name="a.ATest">'+ok+'<testcase name="added"/></testsuite>');if(command.includes('clean'))await writeFile(join(reports,'TEST-b.BTest.xml'),'<testsuite name="b.BTest">'+ok+'</testsuite>');return{exitCode:0,output:''};};
 value.governance.verified=await service['targetedEvidence'](value,root,before,[file],'局部');
 assert.ok(calls[0]?.includes('-Dtest=a.ATest'));assert.ok(!calls[0]?.includes('clean'));
 await service['verify'](value,service['repository']('Demo')!,root);
 assert.ok(calls[1]?.includes('clean'));assert.ok(!calls[1]?.some(arg=>arg.startsWith('-Dtest=')));assert.equal(value.nextStage,'PUBLISH');
});
test('Pi 通过固定会话文件跨轮次和服务重建续接，不同任务隔离且删除时清理', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'pi-session-')),oldPath=process.env.PATH,oldData=process.env.PLATFORM_DATA_DIR,store=new TaskStore(':memory:');let service=new AutoUtService(store,undefined,false);
 t.after(async()=>{await service.close();store.close();if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;if(oldData===undefined)delete process.env.PLATFORM_DATA_DIR;else process.env.PLATFORM_DATA_DIR=oldData;await rm(root,{recursive:true,force:true});});
 process.env.PATH=root+':'+oldPath;process.env.PLATFORM_DATA_DIR=join(root,'persistent');
 const executable=join(root,'pi');await writeFile(executable,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--no-session')||!args.includes('--session'))process.exit(2);
const file=args[args.indexOf('--session')+1];let input='';process.stdin.on('data',chunk=>{input+=chunk;if(!input.includes('\\n'))return;const message=JSON.parse(input).message;fs.appendFileSync(file,JSON.stringify({message})+'\\n');console.log(JSON.stringify({type:'agent_end'}));});
`);await chmod(executable,0o755);
 const prompt=join(root,'prompt.md'),first=task(root),second=task(root,'other-task');await writeFile(prompt,'first repair');
 service.languageSettings.save({java:{mavenRepository:'D:/Maven Cache/repository'}});
 assert.equal((await service['runPi'](first,root,prompt)).exitCode,0);const file=service['piSessionFile'](first);
 const firstMessage=JSON.parse((await readFile(file,'utf8')).trim()).message;assert.ok(firstMessage.includes(JSON.stringify('D:\\Maven Cache\\repository')));assert.match(firstMessage,/禁止 find \//);
 await service.close();service=new AutoUtService(store,undefined,false);await writeFile(prompt,'retry with new failure');
 assert.equal((await service['runPi'](first,root,prompt)).exitCode,0);assert.equal((await readFile(file,'utf8')).trim().split('\n').length,2);
 assert.equal((await service['runPi'](second,root,prompt)).exitCode,0);assert.notEqual(file,service['piSessionFile'](second));assert.equal((await readFile(service['piSessionFile'](second),'utf8')).trim().split('\n').length,1);
 await service.deleteTask(first.id,false);await assert.rejects(readFile(file));assert.ok(await readFile(service['piSessionFile'](second),'utf8'));
});

test('修复局部通过后直接补测试，最终失败回到修复且不重置重试次数',async t=>{
 const root=await mkdtemp(join(tmpdir(),'repair-flow-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root,'repair-flow');
 t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});
 const failed=evidence({'a.ATest':'<testcase name="works"><failure/></testcase>'}),passed=evidence({'a.ATest':ok});
 value.governance={mode:'REPAIR',coverageLow:true,maxClasses:5,baseline:failed};
 service['readSurefire']=async()=>failed;service['runPi']=async()=>({exitCode:0,output:''});service['inspect']=async()=>({accepted:true,changedFiles:['src/test/java/a/ATest.java'],violations:[]});
 service['targetedEvidence']=async()=>passed;service['selectTargets']=async task=>{task.governance!.targets=['src/main/java/B.java'];};
 await service['repair'](value,root);
 assert.equal(value.nextStage,'REPAIR');assert.equal(value.governance.mode,'SUPPLEMENT');assert.equal(value.governance.fixedIds?.length,1);
 value.governance.classResults=[{target:'src/main/java/B.java',status:'PASSED',message:''}];value.attempts=2;
 service['testEvidence']=async()=>({exitCode:1,evidence:failed});await service['verify'](value,service['repository']('Demo')!,root);
 assert.equal(value.governance.mode,'REPAIR');assert.equal(value.nextStage,'REPAIR');
 await service['repair'](value,root);assert.equal(value.nextStage,'VERIFY');assert.equal(value.attempts,2);
});
