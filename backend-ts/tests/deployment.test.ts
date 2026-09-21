import assert from 'node:assert/strict';
import test from 'node:test';
import {parse} from 'yaml';
import {chartHelperTemplatePath,chartTemplatePlan,deploymentResources,DeploymentService,hasBlockingDeploymentPlaceholders,hasDeploymentAnalysisFailures,normalizeOptionalVersions,optionalVersionMarker,replaceBuildMetadata,usedOptionalVersions} from '../src/modules/deployment/deployment.js';
import {buildModules} from '../src/modules/build/build.js';
import {TaskStore} from '../src/platform/store.js';
import {SshOperations} from '../src/infrastructure/ssh.js';
import type {SshTarget,CommandResult} from '../src/infrastructure/ssh.js';

function reviewTask(values:string) {
  return {id:'task',mode:'REVIEW',status:'AWAITING_REVIEW',artifactId:1,environmentId:1,module:'swm',namespace:'mae',revision:1,createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,services:{swmfrontendservice:{service:'swmfrontendservice',stage:'ANALYZED',stageError:null,values,chart:'',templates:{},replaceItems:[],unresolvedImages:['swmfrontendservice'],errors:[]}},events:[],sequence:0};
}

test('相同 values 重复保存不会增加部署 revision', t => {
  const store=new TaskStore(':memory:');t.after(()=>store.close());
  const values='image: repo/swm:{version:swmfrontendservice}';
  store.putRecord('deployment-task','task',reviewTask(values));
  const service=new DeploymentService(store,undefined as never,undefined as never,undefined as never,'/root/.kube/config','/opt/kubeconfig/kubeconfig.txt');
  assert.equal(service.updateValues('task','swmfrontendservice',values).revision,1);
  assert.equal(service.get('task').events.length,0);
});

test('修改 values 后重算阻塞项且仅增加一次 revision', t => {
  const store=new TaskStore(':memory:');t.after(()=>store.close());
  store.putRecord('deployment-task','task',reviewTask('image: repo/swm:{version:swmfrontendservice}'));
  const service=new DeploymentService(store,undefined as never,undefined as never,undefined as never,'/root/.kube/config','/opt/kubeconfig/kubeconfig.txt');
  const updated=service.updateValues('task','swmfrontendservice','image: repo/swm:1.2.3');
  assert.equal(updated.revision,2);
  assert.deepEqual(updated.services.swmfrontendservice?.unresolvedImages,[]);
  assert.equal(updated.services.swmfrontendservice?.stage,'ANALYZED');
  assert.match(service.get('task').events[0]!.message,/可以确认配置并部署/);
});

test('审阅部署允许保留可选镜像版本占位符', () => {
  assert.equal(hasBlockingDeploymentPlaceholders('zenith: {version:zenith}\nredis: {version:redis}'),false);
  assert.equal(hasBlockingDeploymentPlaceholders('value: replaceByOssDiy'),true);
});

test('快速部署分析也允许保留可选镜像版本占位符', () => {
  assert.equal(hasDeploymentAnalysisFailures([{values:'zenith: {version:zenith}',errors:[]}]),false);
  assert.equal(hasDeploymentAnalysisFailures([{values:'value: replaceByOssDiy',errors:['存在未解析占位符']}]),true);
});

test('写入 Chart 前将可选版本转换为合法 YAML 标记', () => {
  const values=normalizeOptionalVersions('zenith: {version:zenith}\nredis: "{version:redis}"');
  assert.deepEqual(parse(values),{zenith:optionalVersionMarker('zenith'),redis:optionalVersionMarker('redis')});
});

test('仅在可选版本实际进入渲染清单时阻止部署', () => {
  assert.deepEqual(usedOptionalVersions('image: repo/app:1.0',['zenith','redis']),[]);
  assert.deepEqual(usedOptionalVersions(`image: repo/app:${optionalVersionMarker('zenith')}`,['zenith','redis']),['zenith']);
});

test('jarlist 替换兼容单双引号且不会生成嵌套引号', () => {
  const jarlist='{"/opt/app":{"lib":{"demo.jar":"1.0"}}}';
  const values=replaceBuildMetadata('a: "replaceByBuild"\nb: \'replaceByBuild\'\nc: replaceByBuild',jarlist);
  assert.deepEqual(parse(values),{a:jarlist,b:jarlist,c:jarlist});
  assert.deepEqual(parse(replaceBuildMetadata('a: "replaceByBuild"','')),{a:''});
});

test('Chart 模板优先级为服务、源码 charts 公共模板、模块模板', () => {
  assert.deepEqual([...chartTemplatePlan(['deploy.yaml','_service.tpl'],['_helpers.tpl','_service.tpl','ignored.yaml'],['_helpers.tpl','_service.tpl','_common.tpl','ignored.yaml'])], [
    ['deploy.yaml','service'],['_service.tpl','service'],['_helpers.tpl','chartHelper'],['_common.tpl','module']
  ]);
  assert.equal(chartTemplatePlan(['_helpers.tpl'],['_helpers.tpl'],['_helpers.tpl']).get('_helpers.tpl'),'service');
});

test('所有构建模块都能从产物路径推导源码 charts 公共模板路径', () => {
  for(const module of buildModules){
    const remoteModuleRoot=`/work/ArchDesign/${module.archDirectory}`;
    assert.equal(chartHelperTemplatePath({remoteModuleRoot,remoteChartsRoot:`${remoteModuleRoot}/target/${module.chartsPath}`}),`${remoteModuleRoot}/charts/${module.chartsPath.split('/')[0]}/templates`);
  }
  assert.throws(()=>chartHelperTemplatePath({remoteModuleRoot:'/work/module',remoteChartsRoot:'/other/chartTool/charts'}));
  assert.throws(()=>chartHelperTemplatePath({remoteModuleRoot:'/work/module',remoteChartsRoot:'/work/module/target/../chartTool/charts'}));
});

const conflictManifest=`apiVersion: logging.example.com/v1
metadata: {name: "beidou.fminsightservice", namespace: mae}
kind: BeidouLog
---
kind: ConfigMap
apiVersion: v1
metadata:
  labels: {app: demo}
  name: 'config.demo'
---
apiVersion: v1
kind: List
items:
- apiVersion: v1
  kind: Service
  metadata: {name: demo, namespace: other}
`;

test('冲突清单解析支持多文档、字段乱序、引号、内联 metadata、List 和 namespace',()=>{
 assert.deepEqual(deploymentResources(conflictManifest,'mae'),[
  {resource:'beidoulog.logging.example.com',name:'beidou.fminsightservice',namespace:'mae'},
  {resource:'configmap',name:'config.demo',namespace:'mae'},
  {resource:'service',name:'demo',namespace:'other'}
 ]);
 assert.equal(deploymentResources(`${conflictManifest}---\n${conflictManifest}`,'mae').length,3);
 assert.throws(()=>deploymentResources('kind: [invalid','mae'));
 assert.throws(()=>deploymentResources('apiVersion: v1\nkind: Secret\nmetadata: {name: "--all"}','mae'));
});

class ConflictSsh extends SshOperations{
 readonly commands:string[]=[];
 constructor(private readonly results:CommandResult[]){super();}
 override async execute(_target:SshTarget,command:string){this.commands.push(command);const result=this.results.shift();assert.ok(result,`意外命令：${command}`);return result;}
}
const conflictTarget:SshTarget={host:'test',port:22,username:'test',password:''};
function conflictFixture(t: test.TestContext,results:CommandResult[]){
 const store=new TaskStore(':memory:');t.after(()=>store.close());
 store.putRecord('deployment-task','task',reviewTask(''));
 const ssh=new ConflictSsh(results),service=new DeploymentService(store,undefined as never,undefined as never,ssh,'/kubectl-config','/helm-config');
 return {ssh,service,run:()=>service['inspectTakeoverResources'](conflictTarget,service.get('task'),'demo',conflictManifest)};
}

test('接管前只查询并记录冲突资源，不执行 kubectl delete',async t=>{
 const {ssh,service,run}=conflictFixture(t,[
  {exitCode:0,lines:['BeidouLog\tmaeaccesschart\tmae\tHelm']},
  {exitCode:0,lines:['ConfigMap\t\t\t']},
  {exitCode:0,lines:['Service\tdemo\tmae\tHelm']}
 ]);
 await run();
 assert.equal(ssh.commands.length,3);
 assert.ok(ssh.commands.every(command=>command.includes(' get ')&&!command.includes(' delete ')));
 const events=service.get('task').events;
 assert.ok(events.some(event=>event.message.includes('共 2 个资源待由 Helm 接管')));
 assert.ok(events.some(event=>event.message.includes('beidou.fminsightservice')&&event.message.includes('原 release maeaccesschart，目标 release demo')));
});

test('不存在的资源跳过，namespace 或 managed-by 不匹配会记录为待接管',async t=>{
 const {ssh,service,run}=conflictFixture(t,[
  {exitCode:0,lines:[]},
  {exitCode:0,lines:['ConfigMap\tdemo\twrong\tHelm']},
  {exitCode:0,lines:['Service\tdemo\tmae\tother']}
 ]);
 await run();assert.equal(ssh.commands.length,3);
 assert.match(ssh.commands[2]!,/get 'service' 'demo' -n 'other'/);
 assert.ok(service.get('task').events.some(event=>event.message.includes('共 2 个资源待由 Helm 接管')));
});

test('归属查询失败终止，不将权限错误当作资源不存在',async t=>{
 const {ssh,run}=conflictFixture(t,[
  {exitCode:0,lines:['BeidouLog\told\tmae\tHelm']},
  {exitCode:1,lines:['Forbidden']}
 ]);
 await assert.rejects(run(),/资源归属检查失败.*Forbidden/);
 assert.equal(ssh.commands.length,2);
});

test('安装采用 take-ownership 并保留 Helm 专用配置、Chart、values 和命名空间',async t=>{
 const {ssh,service}=conflictFixture(t,[{exitCode:0,lines:['installed']}]);
 await service['installRelease'](conflictTarget,service.get('task'),'demo','/tmp/chart dir/demo');
 assert.deepEqual(ssh.commands,["helm --kubeconfig='/helm-config' install --take-ownership 'demo' '/tmp/chart dir/demo' -f '/tmp/chart dir/demo/values.yaml' -n 'mae'"]);
});

test('Helm 安装失败或不支持接管参数时直接失败，不重试或回退删除',async t=>{
 const {ssh,service}=conflictFixture(t,[{exitCode:1,lines:['unknown flag: --take-ownership']}]);
 await assert.rejects(service['installRelease'](conflictTarget,service.get('task'),'demo','/tmp/demo'),/安装失败.*unknown flag/);
 assert.equal(ssh.commands.length,1);
});
