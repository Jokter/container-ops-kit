import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runProcess} from '../src/infrastructure/process.js';
import {TaskStore} from '../src/platform/store.js';
import {AutoUtService,autoUtWorkspace,type AutoUtTask} from '../src/modules/autout/autout.js';
import {jestCommand,readJestReport,jsTestViolations,usesJest} from '../src/modules/autout/jest.js';
import {utLanguage,utPlanKey,utRepairBranch,utTestFile} from '../src/modules/autout/languages.js';
import {utRegressionPassed} from '../src/modules/autout/governance.js';
function report(website:string,failed=13){return JSON.stringify({numTotalTests:61,numRuntimeErrorTestSuites:0,testResults:[{name:join(website,'src/__tests__/containers/TopoSvg/index.test.js'),status:failed?'failed':'passed',assertionResults:Array.from({length:61},(_,i)=>({title:'case '+i,ancestorTitles:['TopoSvg'],status:i<failed?'failed':'passed',failureMessages:i<failed?['expected element to exist']:[]}))}]});}
function task(root:string):AutoUtTask{return{language:'JS',id:randomUUID(),repository:'Mixed',reportVersion:'R27',username:'tester',ticket:'DTS1',baseBranch:'main',repairBranch:'main_tester_DTS1',workspaceRoot:root,executionMode:'MANUAL',status:'BASELINE_RUNNING',nextStage:'BASELINE',progress:25,attempts:0,message:'',pullRequestUrl:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reportedFailedTests:13,lineGoal:.8,branchGoal:.7,history:[],liveEvents:[],liveSequence:0};}
test('Jest 61 个实际用例识别 13 失败；回归必须全部保留并通过',()=>{
 const before=readJestReport(report('/repo/website'),'/repo/website'),after=readJestReport(report('/repo/website',0),'/repo/website');
 assert.equal(before.tests,61);assert.equal(before.failures,13);assert.equal(before.passedIds.length,48);assert.match(before.details,/TopoSvg/);
 assert.equal(utRegressionPassed(before,after,0),true);assert.equal(utRegressionPassed(before,before,1),false);
 const data=JSON.parse(report('/repo/website',0));data.testResults[0].assertionResults[0].status='pending';assert.equal(utRegressionPassed(before,readJestReport(JSON.stringify(data),'/repo/website'),0),false);
 data.testResults[0].assertionResults.shift();data.numTotalTests--;assert.equal(utRegressionPassed(before,readJestReport(JSON.stringify(data),'/repo/website'),0),false);
 for(const content of ['{}','not json',JSON.stringify({numTotalTests:0,testResults:[]}),JSON.stringify({numTotalTests:0,numRuntimeErrorTestSuites:1,testResults:[]})])assert.throws(()=>readJestReport(content,'/repo/website'),/核验受阻/);
 assert.throws(()=>readJestReport(report('/elsewhere'),'/repo/website'),/之外/);
 assert.equal(readJestReport(report('D:/repo/website'),'D:/repo/website').tests,61);
});
test('JS 基线在 website 先 Maven 生成 package，直接运行 npm test；拒绝缺失、旧报告和异常退出',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autout-js-')),website=join(root,'website'),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root);
 t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});await rm(join(service['jsReport'](value),'..'),{recursive:true,force:true});});
 await assert.rejects(service['baseline'](value,service['repository']('Mixed')!,root),/website/);
 await mkdir(website);
 const calls:string[][]=[];
 service['command']=async(_task,command,directory)=>{if(command[0]==='git')return{exitCode:0,output:''};assert.equal(directory,website);calls.push(command);if(command[0]==='mvn'){await assert.rejects(readFile(join(website,'package.json')));await writeFile(join(website,'package.json'),JSON.stringify({scripts:{test:'node ./node_modules/jest/bin/jest.js'}}));return{exitCode:0,output:''};}await assert.rejects(readFile(service['jsReport'](value)));await writeFile(service['jsReport'](value),report(website));return{exitCode:1,output:'13 failed, 48 passed, 61 total'};};
 assert.equal((await service['baseline'](value,service['repository']('Mixed')!,root)).failures,13);
 assert.deepEqual(calls,[['mvn','clean','install'],jestCommand(service['jsReport'](value))]);
 service['command']=async()=>({exitCode:1,output:'Cannot find module jest'});await assert.rejects(service['testEvidence'](value,[],root,'缺少依赖'),/未生成/);
 service['command']=async()=>{await writeFile(service['jsReport'](value),report(website,0));return{exitCode:1,output:'runtime error'};};await assert.rejects(service['testEvidence'](value,[],root,'运行异常'),/运行异常/);
 service['command']=async()=>{await writeFile(service['jsReport'](value),report(website));return{exitCode:124,output:'timeout'};};await assert.rejects(service['testEvidence'](value,[],root,'超时'),/未正常完成/);
 const logs=join(service['jsReport'](value),'..');assert.equal((await readdir(logs)).filter(name=>/^jest-results-.+\.json$/.test(name)).length,3);const trace=await readFile(join(logs,'diagnostics.jsonl'),'utf8');assert.match(trace,/jest_result/);assert.match(trace,/jest_blocked/);assert.match(trace,/jest_report_unavailable/);
});
test('Java、JS 使用统一目录，分支命名一致、任务独立且禁止同时占用；Python 不支持',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autout-mixed-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false);
 t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});service['schedule']=()=>{};
 const csv=Buffer.from('代码仓,语言,PL组,失败用例,行覆盖率,行覆盖率目标,分支覆盖率,分支覆盖率目标\nMixed,Java,Access_智能驾舱组,1,.1,.8,.1,.7\nMixed,JS,Access_智能驾舱组,13,.1,.8,.1,.7\nMixed,Py,Access_智能驾舱组,1,.1,.8,.1,.7\n');
 const javaCsv=Buffer.from(csv.toString().split('\n').filter(line=>!line.includes(',JS,')).join('\n')),jsCsv=Buffer.from(csv.toString().split('\n').filter(line=>!line.includes(',Java,')).join('\n'));
 const java=(await service.start(javaCsv,'tester','DTS1','main',root,'MANUAL',{version:'R27',reportId:'report'}))[0]!;
 await assert.rejects(service.start(jsCsv,'tester','DTS1','main',root,'MANUAL',{version:'R27',reportId:'report'}),/依次治理/);
 await service.deleteTask(java.id,false);
 const js=(await service.start(jsCsv,'tester','DTS1','main',root,'MANUAL',{version:'R27',reportId:'report'}))[0]!;assert.equal(autoUtWorkspace(java),autoUtWorkspace(js));assert.equal(autoUtWorkspace(js),join(root,'R27','mixed'));assert.equal(java.repairBranch,js.repairBranch);assert.equal(js.language,'JS');
 const legacy={...js,workspacePath:join(root,'.auto-ut-js','R27','mixed')};assert.equal(autoUtWorkspace(legacy),legacy.workspacePath);
 assert.equal(utPlanKey({version:'R27',repository:'Mixed'}),'R27/Mixed');assert.equal(utPlanKey({version:'R27',repository:'Mixed',language:'JS'}),'R27/Mixed/JS');assert.equal(utRepairBranch('main','tester','DTS1'),js.repairBranch);assert.equal(js.repairBranch,'main_tester_DTS1');assert.equal(utRepairBranch('master','w00789509','DTS2026100876365'),'master_w00789509_DTS2026100876365');
 assert.equal(service.blocksRepository('Mixed','R27','main','JS'),true);store.deleteRecord('auto-ut-task',js.id);store.deleteRecord('auto-ut-governance',js.id);assert.equal(service.blocksRepository('Mixed','R27','main','JS'),false);assert.equal(service.blocksRepository('Mixed','R27','main'),false);assert.equal(utLanguage('Python'),undefined);
});
test('JS 修改门禁接受 JSX 与 mock，拒绝源码、配置、快照、跳过和删断言',async t=>{
 for(const path of ['website/src/a.test.js','website/src/a.spec.jsx','website/src/__tests__/a.jsx','website/src/__mocks__/api.js'])assert.equal(utTestFile(path,'JS'),true);
 for(const path of ['website/src/a.js','website/package.json','website/src/__snapshots__/a.snap','src/test/java/A.java','website/node_modules/a.test.js'])assert.equal(utTestFile(path,'JS'),false);
 assert.ok(jsTestViolations('test("a",()=>{expect(x).toBe(1)})','test.skip("a",()=>{})','test.skip("a",()=>{})').length>=2);
 assert.ok(jsTestViolations('','','test.only("x",()=>expect(true).toBe(true))').length>=2);
 const root=await mkdtemp(join(tmpdir(),'js-guard-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root);t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});
 await mkdir(join(root,'website/src'),{recursive:true});await writeFile(join(root,'website/src/a.test.jsx'),'test("a",()=>expect(actual()).toBe(1))');
 let status='?? website/src/a.test.jsx\n?? website/node_modules/x/index.js\n?? website/coverage/index.html\n';service['command']=async(_task,command)=>({exitCode:command.includes('show')?1:0,output:command.includes('status')?status:''});
 assert.equal((await service['inspect'](value,root,'门禁')).accepted,true);status+=' M website/package.json\n M website/src/a.js\n';const result=await service['inspect'](value,root,'门禁');assert.equal(result.accepted,false);assert.equal(result.violations.length,2);
});

test('Jest 入口按项目脚本识别，支持转发参数的别名与 CRA，不猜测其他框架',()=>{
 for(const scripts of [{test:'jest'},{test:'cross-env NODE_ENV=test jest --config config/jest.js'},{test:'node ./node_modules/jest/bin/jest.js'},{test:'react-scripts test'},{test:'react-app-rewired test'},{test:'npm run unit --',unit:'jest'}])assert.equal(usesJest(scripts),true);
 for(const scripts of [{test:'vitest run'},{test:'mocha'},{test:'node scripts/test.js'},{test:'npm run unit --',unit:'npm run test --'},{test:'npm run unit',unit:'jest'}])assert.equal(usesJest(scripts),false);
});
test('不同服务的多套件、JS/JSX/TS、任意用例数量和重复名称均从报告读取',()=>{
 const website='/work/another/website';
 for(const count of [1,7,103]){
  const content=JSON.stringify({numTotalTests:count+2,testResults:[{name:website+'/test/math.spec.js',status:'passed',assertionResults:Array.from({length:count},()=>({title:'same title',ancestorTitles:['data driven'],status:'passed'}))},{name:website+'/app/panel.test.jsx',status:'failed',assertionResults:[{title:'renders',status:'failed',failureMessages:['TypeError: missing mock']}]},{name:website+'/lib/__tests__/value.test.ts',status:'passed',assertionResults:[{title:'optional case',status:'pending'}]}]});
  const result=readJestReport(content,website);assert.equal(result.tests,count+2);assert.equal(result.passedIds.length,count);assert.equal(result.failures,1);assert.equal(result.skipped,1);assert.equal(new Set(result.caseIds).size,count+2);assert.match(result.details,/panel.test.jsx/);
 }
});
test('补测试目标不排除某个服务的目录与 index 模块，也支持非 src 代码目录',async t=>{
 const root=await mkdtemp(join(tmpdir(),'js-sources-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root);t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});
 for(const name of ['website/lib/util.js','website/app/index.jsx','website/src/@u2020/index.js','website/src/widget.test.jsx']){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),'export const value=1;');}
 value.governance={mode:'SUPPLEMENT',coverageLow:true,maxClasses:5};await service['selectTargets'](value,root);assert.deepEqual(value.governance.targets,['website/app/index.jsx','website/lib/util.js','website/src/@u2020/index.js']);
});

test('仓库地址不按服务硬编码，失败任务保存自定义后重试使用新地址且服务重启后保留',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ut-url-')),store=new TaskStore(':memory:');let service=new AutoUtService(store,undefined,false);t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});});
 const value=task(root);value.repository='FMEMateWebsite';value.status='WAITING_EXTERNAL';value.nextStage='PREPARE';service['save'](value);
 assert.match(service.get(value.id).repositoryUrl!,/MAE-M\/Access\/FMEMateWebsite.git$/);
 const url='ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/FMEMate/FMEMateWebsite.git';service.saveRepository(value.repository,url);let selected='';service['schedule']=(_task,repository)=>{selected=repository.url;};service.continue(value.id);assert.equal(selected,url);
 await service.close();service=new AutoUtService(store,undefined,false);assert.equal(service.get(value.id).repositoryUrl,url);assert.equal(service.get(value.id).repositoryCustomized,true);assert.equal(service['repository']('fmematewebsite')!.url,url);
});

test('JS Maven 初始化失败时停止；成功后才校验 package 和 test 脚本',async t=>{
 const root=await mkdtemp(join(tmpdir(),'js-init-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root),website=join(root,'website');t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});await rm(join(service['jsReport'](value),'..'),{recursive:true,force:true});});await mkdir(website);
 const calls:string[][]=[];service['command']=async(_task,command,directory)=>{if(command[0]==='git')return{exitCode:0,output:''};calls.push(command);assert.equal(directory,website);throw Error('初始化JS项目-Maven失败，退出码 1');};
 await assert.rejects(service['baseline'](value,service['repository']('Mixed')!,root),/Maven失败/);assert.deepEqual(calls,[['mvn','clean','install']]);
 calls.length=0;service['command']=async(_task,command)=>{if(command[0]!=='git')calls.push(command);return{exitCode:0,output:''};};await assert.rejects(service['baseline'](value,service['repository']('Mixed')!,root),/package.json/);assert.deepEqual(calls,[['mvn','clean','install']]);
});


test('真实 Git 工作区只提交修复测试，Maven 生成配置与构建文件保留但不提交',async t=>{
 const root=await mkdtemp(join(tmpdir(),'js-init-git-')),store=new TaskStore(':memory:'),service=new AutoUtService(store,undefined,false),value=task(root);
 t.after(async()=>{await service.close();store.close();await rm(root,{recursive:true,force:true});await rm(join(service['jsReport'](value),'..'),{recursive:true,force:true});});
 const git=async(args:string[])=>{const r=await runProcess(['git',...args],root,10000);assert.equal(r.exitCode,0,r.output);return r.output.trim();};
 await mkdir(join(root,'deployment/src/main/release/pub'),{recursive:true});await writeFile(join(root,'deployment/src/main/release/pub/febs.json'),'original release');
 await git(['init']);await git(['config','user.name','UT fixture']);await git(['config','user.email','fixture@example.invalid']);await mkdir(join(root,'website/src'),{recursive:true});
 await writeFile(join(root,'website/babel.config.js'),'original');await writeFile(join(root,'website/src/a.test.js'),'test("a",()=>expect(value).toBe(1))');await git(['add','.']);await git(['commit','-m','baseline']);
 service['command']=async(_task,command,directory)=>{
  if(command[0]!=='mvn')return runProcess(command,directory,10000);
  await writeFile(join(root,'deployment/src/main/release/pub/febs.json'),'generated release');await writeFile(join(root,'website/babel.config.js'),'generated');await writeFile(join(root,'website/package.json'),JSON.stringify({scripts:{test:'jest'}}));await mkdir(join(root,'website/build'),{recursive:true});await writeFile(join(root,'website/build/generated.test.js'),'build artifact');return{exitCode:0,output:''};
 };
 await service['initializeJs'](value,root);
 assert.equal((await service['inspect'](value,root,'未修改')).changedFiles.length,0);
 await writeFile(join(root,'website/src/a.test.js'),'test("a",()=>expect(value).toBe(2))');
 const guard=await service['inspect'](value,root,'修复');assert.equal(guard.accepted,true,guard.violations.join(';'));assert.deepEqual(guard.changedFiles,['website/src/a.test.js']);
 await git(['add','--',...guard.changedFiles]);assert.equal(await git(['diff','--cached','--name-only']),'website/src/a.test.js');await git(['commit','-m','test fix']);assert.equal(await git(['diff','--name-only','HEAD~','HEAD']),'website/src/a.test.js');
 await writeFile(join(root,'website/babel.config.js'),'agent change');await assert.rejects(service['inspect'](value,root,'非法配置'),/非测试文件发生变化/);
});
