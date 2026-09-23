import {compileCommand,defaultCompileCommand,taskMavenCommand} from '../src/modules/autout/compile-command.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AutoUtService,parseCodecovReport,surefireFailureDetails,type AutoUtTask} from '../src/modules/autout/autout.js';
import {TaskStore} from '../src/platform/store.js';
import {runProcess} from '../src/infrastructure/process.js';

test('从 codecovcli 混合日志中提取测试结果和覆盖率 JSON',()=>{
 const output=`[INFO] codecovcli analyze\nnoise {not-json}\n${JSON.stringify({result:{tests:{total:18,failed:2,errors:1,skipped:3},coverage:{line:{covered:81,missed:19},branch:{percentage:'72.5%'}}}})}\n[INFO] done`;
 assert.deepEqual(parseCodecovReport(output),{tests:18,failures:2,errors:1,skipped:3,line:.81,branch:.725});
});

test('Codecov 报告缺少覆盖率时给出明确错误',()=>{
 assert.throws(()=>parseCodecovReport('{"tests":10,"failures":0}'),/无法从 codecovcli/);
});

test('Surefire 详情只保留失败用例而不包含 properties',()=>{
 const xml=`<?xml version="1.0"?><testsuite tests="2" failures="1" errors="1"><properties><property name="java.class.path" value="very-long-useless-classpath"/></properties><testcase classname="demo.ServiceTest" name="works"/><testcase classname="demo.ServiceTest" name="fails"><failure type="java.lang.AssertionError" message="expected 1">stack failure</failure></testcase><testcase classname="demo.OtherTest" name="errors"><error type="java.lang.NullPointerException" message="boom">stack error</error></testcase></testsuite>`;
 const details=surefireFailureDetails(xml).join('\n');assert.match(details,/demo\.ServiceTest#fails/);assert.match(details,/AssertionError/);assert.match(details,/stack error/);assert.doesNotMatch(details,/java\.class\.path|very-long-useless-classpath/);
});

test('修改门禁忽略非测试产物且只收集 src/test 文件',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autout-inspect-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);t.after(async()=>{service.close();store.close();await rm(root,{recursive:true,force:true});});
 await mkdir(join(root,'src/test/java'),{recursive:true});await mkdir(join(root,'src/main/java'),{recursive:true});await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(value); } }');await writeFile(join(root,'src/main/java/Demo.java'),'class Demo {}');
 for(const command of [['git','init'],['git','config','user.email','test@example.com'],['git','config','user.name','Test'],['git','add','.'],['git','commit','-m','base']])assert.equal((await runProcess(command,root,10000)).exitCode,0);
 await writeFile(join(root,'src/test/java/DemoTest.java'),'class DemoTest { @Test void ok(){ assertTrue(value); } }\n// repaired');await mkdir(join(root,'.codecovcli/report'),{recursive:true});await writeFile(join(root,'.codecovcli/report/result.json'),'{}');await writeFile(join(root,'src/main/java/Demo.java'),'class Demo { int ignored; }');
 const now=new Date().toISOString(),task:AutoUtTask={id:'test-task',repository:'demo',username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:root,executionMode:'AUTOMATIC',status:'REPAIRING',nextStage:'REPAIR',progress:45,attempts:1,message:'',pullRequestUrl:'',createdAt:now,updatedAt:now,history:[],liveEvents:[],liveSequence:0};
 const guard=await service['inspect'](task,root,'门禁测试');assert.equal(guard.accepted,true);assert.deepEqual(guard.changedFiles,['src/test/java/DemoTest.java']);
});

test('临时编译命令只接受固定模板和模块选择，拒绝额外命令与越界路径',()=>{
 const base=defaultCompileCommand.join(' ');
 assert.deepEqual(compileCommand(base+' -pl model,website-service -am'),[...defaultCompileCommand,'-pl','model,website-service','-am']);
 for(const suffix of [' && echo bad',' -pl ../other',' -pl /tmp/demo',' -pl model;echo',' -Dtest=Skip',' deploy',' -pl model -s other.xml','\n'])assert.throws(()=>compileCommand(base+suffix));
 assert.throws(()=>compileCommand(base.replace('test-compile','deploy')));
});
test('任务模块范围在编译和后续重试保留，旧失败记录可识别',async()=>{
 const store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);
 const task:AutoUtTask={id:'compile',repository:'demo',username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'repair',reportedFailedTests:1,lineGoal:.8,branchGoal:.7,workspaceRoot:'/tmp',executionMode:'AUTOMATIC',status:'WAITING_EXTERNAL',nextStage:'BASELINE',progress:25,attempts:0,message:'刷新Maven依赖与预编译失败，退出码 1',pullRequestUrl:'',createdAt:'',updatedAt:'',history:[],liveEvents:[],liveSequence:0};
 store.putRecord('auto-ut-task',task.id,task);assert.ok(service.get(task.id).compileFailure);
 const commands:string[][]=[];service['command']=async(_task,args)=>{commands.push(args);return {exitCode:0,output:''};};
 const evidence={tests:1,failures:0,errors:0,skipped:0,caseIds:['T#test'],failedIds:[],passedIds:['T#test'],details:''};
 service['testEvidence']=async(_task,args)=>{commands.push(args);return {evidence,exitCode:0};};
 const repository=service['repository']('demo')!;
 task.mavenSelection=['-pl','model,website-service'];
 try{await service['baseline'](task,repository,'/tmp');assert.deepEqual(task.mavenSelection,['-pl','model,website-service']);assert.equal(task.compileFailure,undefined);assert.ok(commands[0]!.includes('-pl'));assert.ok(!commands[1]!.includes('-pl'));
 await service['baseline'](task,repository,'/tmp');assert.deepEqual(commands[2],[...defaultCompileCommand,'-pl','model,website-service']);
 assert.deepEqual(taskMavenCommand(['mvn','test'],task.mavenSelection),['mvn','test','-pl','model,website-service']);assert.deepEqual(taskMavenCommand(['mvn','test']),['mvn','test']);
 task.status='REPAIRING';store.putRecord('auto-ut-task',task.id,task);assert.throws(()=>service.retryCompile(task.id,defaultCompileCommand.join(' ')),/仅可/);
 }finally{await service.close();store.close();}
});
