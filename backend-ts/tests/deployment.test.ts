import assert from 'node:assert/strict';
import test from 'node:test';
import {DeploymentService,hasBlockingDeploymentPlaceholders} from '../src/modules/deployment/deployment.js';
import {TaskStore} from '../src/platform/store.js';

function reviewTask(values:string) {
  return {id:'task',mode:'REVIEW',status:'AWAITING_REVIEW',artifactId:1,environmentId:1,module:'swm',namespace:'mae',revision:1,createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,services:{swmfrontendservice:{service:'swmfrontendservice',stage:'ANALYZED',stageError:null,values,chart:'',templates:{},replaceItems:[],unresolvedImages:['swmfrontendservice'],errors:[]}},events:[],sequence:0};
}

test('相同 values 重复保存不会增加部署 revision', t => {
  const store=new TaskStore(':memory:');t.after(()=>store.close());
  const values='image: repo/swm:{version:swmfrontendservice}';
  store.putRecord('deployment-task','task',reviewTask(values));
  const service=new DeploymentService(store,undefined as never,undefined as never,undefined as never);
  assert.equal(service.updateValues('task','swmfrontendservice',values).revision,1);
  assert.equal(service.get('task').events.length,0);
});

test('修改 values 后重算阻塞项且仅增加一次 revision', t => {
  const store=new TaskStore(':memory:');t.after(()=>store.close());
  store.putRecord('deployment-task','task',reviewTask('image: repo/swm:{version:swmfrontendservice}'));
  const service=new DeploymentService(store,undefined as never,undefined as never,undefined as never);
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
