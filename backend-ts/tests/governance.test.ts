import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutoUtService,type AutoUtTask} from '../src/modules/autout/autout.js';
import {TaskStore} from '../src/platform/store.js';
test('逐类补测试时回退失败类，保留通过类，最终统一回归',async t=>{
 const {root,service}=await fixture(t),value=task(root);
 value.governance={mode:'SUPPLEMENT',coverageLow:true,maxClasses:5,baseline:passed,targets:['src/main/java/A.java','src/main/java/B.java']};
 const dir=join(root,'src/test/java');await mkdir(dir,{recursive:true});await writeFile(join(dir,'OriginalTest.java'),'original');
 let calls=0;service['runPi']=async()=>{calls++;await writeFile(join(dir,calls===1?'FailedTest.java':'AddedTest.java'),'test');await writeFile(join(dir,'OriginalTest.java'),calls===1?'bad':'original');return{exitCode:calls===1?1:0,output:''};};
 service['inspect']=async()=>({accepted:true,changedFiles:['src/test/java/AddedTest.java'],violations:[]});
 service['testEvidence']=async()=>({exitCode:0,evidence:evidence('<testcase classname="DemoTest" name="works"/><testcase classname="AddedTest" name="new"/>')});
 await service['supplement'](value,root);
 assert.equal(calls,2);assert.equal(value.nextStage,'VERIFY');assert.equal(value.governance.classResults?.[0]?.status,'FAILED');assert.equal(value.governance.classResults?.[1]?.status,'PASSED');
 await assert.rejects(readFile(join(dir,'FailedTest.java')));assert.equal(await readFile(join(dir,'OriginalTest.java'),'utf8'),'original');assert.equal(value.governance.addedIds?.length,1);
});
import {readUtXml,decideGovernance,verifiedChanges,utRegressionPassed,governanceMetrics,type GovernanceRecord} from '../src/modules/autout/governance.js';

const evidence=(body:string)=>readUtXml([{path:'target/surefire-reports/TEST-Demo.xml',content:'<testsuite>'+body+'</testsuite>'}]);
const passed=evidence('<testcase classname="DemoTest" name="works"/>');
const failed=evidence('<testcase classname="DemoTest" name="works"><failure message="bad"/></testcase>');
function task(root:string):AutoUtTask{return{id:'11111111-1111-4111-8111-111111111111',repository:'Demo',reportVersion:'R27C10',username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'fix',workspaceRoot:root,executionMode:'AUTOMATIC',status:'DISCOVERED',nextStage:'BASELINE',progress:0,attempts:0,message:'',pullRequestUrl:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reportedFailedTests:99,lineGoal:.8,branchGoal:.7,history:[],liveEvents:[],liveSequence:0,governance:{mode:'NONE',coverageLow:false,maxClasses:5}};}
async function fixture(t:import('node:test').TestContext){const root=await mkdtemp(join(tmpdir(),'governance-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);t.after(async()=>{service.close();store.close();await rm(root,{recursive:true,force:true});});return{root,store,service};}

test('实际测试决定修复，报告覆盖率决定补测试；空报告不视为通过',()=>{
 assert.equal(decideGovernance(failed,false),'REPAIR');
 assert.equal(decideGovernance(failed,true),'REPAIR');
 assert.equal(decideGovernance(passed,true),'SUPPLEMENT');
 assert.equal(decideGovernance(passed,false),'NONE');
 assert.throws(()=>decideGovernance(evidence(''),false),/未执行/);
 assert.throws(()=>decideGovernance(evidence('<testcase name="skip"><skipped/></testcase>'),false),/未执行/);
});
test('以用例身份确认真实修复和新增，禁止删除、改名或跳过原有失败用例',()=>{
 const after=evidence('<testcase classname="DemoTest" name="works"/><testcase classname="DemoTest" name="added"/>');
 assert.equal(utRegressionPassed(failed,after,0),true);
 assert.equal(verifiedChanges(failed,after).fixedIds.length,1);
 assert.equal(verifiedChanges(failed,after).addedIds.length,1);
 assert.equal(utRegressionPassed(failed,evidence('<testcase name="different"/>'),0),false);
 assert.equal(utRegressionPassed(failed,evidence('<testcase classname="DemoTest" name="works"><skipped/></testcase>'),0),false);
 assert.equal(utRegressionPassed(failed,after,1),false);
});
test('嵌套 testsuites 按实际用例去重，不依赖总数字段',()=>{
 const document={path:'m/target/surefire-reports/TEST-Demo.xml',content:'<testsuites><testsuite><testcase classname="X" name="ok"/><testcase classname="X" name="err"><error/></testcase></testsuite></testsuites>'};
 const result=readUtXml([document,document]);assert.equal(result.tests,2);assert.equal(result.errors,1);assert.equal(result.passedIds.length,1);
});
test('报告误报失败而实际通过时不调用 Pi、不创建分支或 MR',async t=>{
 const {root,service}=await fixture(t),value=task(root);
 service['baseline']=async()=>passed;
 service['checkoutBranch']=async()=>{throw new Error('不应创建分支');};
 service['repair']=async()=>{throw new Error('不应调用 Pi');};
 await service['execute'](value,service['repository']('Demo')!);
 assert.equal(value.status,'RESOLVED');assert.equal(value.nextStage,'DONE');assert.equal(value.pullRequestUrl,'');
 assert.equal(service.governanceSummary().metrics.fixedCases,0);
});
test('报告失败数不一致也按实际失败修复，不阻断任务',async t=>{
 const {root,service}=await fixture(t),value=task(root);value.executionMode='MANUAL';service['baseline']=async()=>failed;service['checkoutBranch']=async()=>{};
 await service['execute'](value,service['repository']('Demo')!);
 assert.equal(value.nextStage,'REPAIR');assert.equal(value.governance?.mode,'REPAIR');assert.equal(value.governance?.baseline?.failures,1);
});
test('实际通过但报告覆盖率低时直接进入补测试',async t=>{
 const {root,service}=await fixture(t),value=task(root);value.executionMode='MANUAL';value.governance!.coverageLow=true;
 service['baseline']=async()=>passed;service['checkoutBranch']=async()=>{};service['selectTargets']=async task=>{task.governance!.targets=['src/main/java/RuleService.java'];};
 await service['execute'](value,service['repository']('Demo')!);
 assert.equal(value.nextStage,'REPAIR');assert.equal(value.governance?.mode,'SUPPLEMENT');
});
test('候选类排除已有测试引用、DTO 和生成类，按配置限制数量',async t=>{
 const {root,service}=await fixture(t),value=task(root);
 await mkdir(join(root,'src/main/java'),{recursive:true});await mkdir(join(root,'src/test/java'),{recursive:true});
 for(const name of ['AService','BService','CService','UserDTO','AlreadyTested'])await writeFile(join(root,'src/main/java',name+'.java'),'class '+name+' { int run(){ return 1; } }');
 await writeFile(join(root,'src/test/java/ExistingTest.java'),'class ExistingTest { AlreadyTested value; }');
 value.governance!.maxClasses=2;await service['selectTargets'](value,root);
 assert.deepEqual(value.governance!.targets,['src/main/java/AService.java','src/main/java/BService.java']);
});
test('开始核验前清理陈旧 XML，命令只运行 Maven UT 且关闭 JaCoCo',async t=>{
 const {root,service}=await fixture(t),value=task(root),dir=join(root,'target/surefire-reports');await mkdir(dir,{recursive:true});const report=join(dir,'TEST-Demo.xml');await writeFile(report,'<testsuite/>');
 service['command']=async(_task,command)=>{if(command.includes('test-compile')){assert.ok(command.includes('-DskipTests'));return{exitCode:0,output:'BUILD SUCCESS'};}assert.ok(command.includes('clean'));assert.ok(command.includes('-Djacoco.skip=true'));assert.ok(command.includes('.ci/settings.xml'));assert.equal(command[0],'mvn');await assert.rejects(readFile(report));await writeFile(report,'<testsuite><testcase classname="DemoTest" name="works"/></testsuite>');return{exitCode:0,output:'BUILD SUCCESS'};};
 assert.equal((await service['baseline'](value,service['repository']('Demo')!,root)).tests,1);
});
test('成果统计去重并排除失败、误报和已关闭 MR，连续天数按实际启动计算',()=>{
 const make=(id:string,date:string):GovernanceRecord=>({id,repository:'Demo',reportVersion:'R27C10',baseBranch:'main',status:'RESOLVED',message:'',createdAt:date,updatedAt:date,pullRequestUrl:'mr',governance:{mode:'REPAIR',coverageLow:false,maxClasses:5,startedAt:date,fixedIds:['X#test'],addedIds:['Y#added'],mrState:'PENDING'}});
 const records=[make('1','2026-09-21T02:00:00Z'),make('2','2026-09-22T02:00:00Z')];
 assert.deepEqual(governanceMetrics(records,new Date('2026-09-22T03:00:00Z')),{streak:2,fixedServices:1,fixedCases:1,supplementedServices:1,addedCases:1});
 records[0]!.governance.mrState='CLOSED';records[1]!.status='WAITING_EXTERNAL';assert.equal(governanceMetrics(records).fixedCases,0);
});
test('清理任务后保留成果和 MR 阻断记录，确认合并后解除阻断',async t=>{
 const {root,service}=await fixture(t),value=task(root);value.status='RESOLVED';value.nextStage='DONE';value.pullRequestUrl='https://example.com/mr/1';value.governance!.mrState='PENDING';value.governance!.fixedIds=['X#test'];service['save'](value);
 await service.deleteTask(value.id);
 assert.equal(service.governanceSummary().metrics.fixedCases,1);assert.equal(service.blocksRepository('Demo','R27C10','main'),true);
 service.resolveMr(value.id,'MERGED');assert.equal(service.blocksRepository('Demo','R27C10','main'),false);
});

test('基线检查前刷新 Maven 依赖并预编译，准备失败时不运行 UT',async t=>{
 const {root,service}=await fixture(t),value=task(root),repository=service['repository']('Demo')!,calls:string[]=[];
 service['command']=async(_task,command,directory,_timeout,label)=>{assert.equal(directory,root);assert.deepEqual(command,['mvn','-B','-ntp','-U','-s','.ci/settings.xml','test-compile','-DskipTests','-Djacoco.skip=true']);calls.push(label);return{exitCode:0,output:''};};
 service['testEvidence']=async()=>{calls.push('UT');return{exitCode:0,evidence:passed};};
 assert.equal(await service['baseline'](value,repository,root),passed);assert.deepEqual(calls,['刷新Maven依赖与预编译','UT']);
 calls.length=0;service['command']=async()=>{throw Error('依赖下载失败');};await assert.rejects(service['baseline'](value,repository,root),/依赖下载失败/);assert.deepEqual(calls,[]);
});
