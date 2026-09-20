import assert from 'node:assert/strict';
import test from 'node:test';
import {parse} from 'yaml';
import {chartHelperTemplatePath,chartTemplatePlan,DeploymentService,hasBlockingDeploymentPlaceholders,hasDeploymentAnalysisFailures,normalizeOptionalVersions,optionalVersionMarker,replaceBuildMetadata,usedOptionalVersions} from '../src/modules/deployment/deployment.js';
import {buildModules} from '../src/modules/build/build.js';
import {TaskStore} from '../src/platform/store.js';

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
