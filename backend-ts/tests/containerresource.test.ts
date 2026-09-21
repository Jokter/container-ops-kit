import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {containerKubectlCommand,containerNamespaceNames,containerResourceOwnerHints,containerResourceRoutes,propagateContainerResourceOwners} from '../src/modules/containerresource/containerresource.js';
import {readConfig} from '../src/config.js';

test('容器资源命令使用独立 kubectl 配置且不会重复 kubectl', () => {
  const command=containerKubectlCommand('/root/.kube/config',"get 'deployments.apps' -n 'mae' -o json");
  assert.equal(command,"kubectl --kubeconfig='/root/.kube/config' get 'deployments.apps' -n 'mae' -o json");
  assert.equal((command.match(/\bkubectl\b/g)??[]).length,1);
});

test('命名空间读取结果去空、去重并排序', () => {
  assert.deepEqual(containerNamespaceNames(['mae ','', ' kube-system', 'mae', 'default']),['default','kube-system','mae']);
});

test('kubectl 与 Helm 配置分别默认、覆盖且拒绝空路径', () => {
  const defaults=readConfig({});
  assert.equal(defaults.kubectlKubeconfig,'/root/.kube/config');
  assert.equal(defaults.helmKubeconfig,'/opt/kubeconfig/kubeconfig.txt');
  const config=readConfig({DEPLOYMENT_KUBECTL_KUBECONFIG:'/custom/plain config',DEPLOYMENT_HELM_KUBECONFIG:'/custom/encrypted'});
  assert.equal(config.kubectlKubeconfig,'/custom/plain config');
  assert.equal(config.helmKubeconfig,'/custom/encrypted');
  assert.equal(containerKubectlCommand(config.kubectlKubeconfig,'get pods'),"kubectl --kubeconfig='/custom/plain config' get pods");
  assert.throws(()=>readConfig({DEPLOYMENT_KUBECTL_KUBECONFIG:' '}));
  assert.throws(()=>readConfig({DEPLOYMENT_HELM_KUBECONFIG:''}));
});

test('读取服务资源时只把资源坐标传给严格校验',async()=>{
 const app=Fastify({logger:false});let received:unknown;
 containerResourceRoutes(app,{read:async(environmentId:number,value:unknown)=>{received={environmentId,value};return{ok:true};}} as never);
 try{const response=await app.inject({method:'GET',url:'/api/container-resources?environmentId=3&group=apps&version=v1&resource=deployments&namespace=mae&name=demo'});assert.equal(response.statusCode,200);assert.deepEqual(received,{environmentId:3,value:{group:'apps',version:'v1',resource:'deployments',namespace:'mae',name:'demo'}});}finally{await app.close();}
});

test('服务资源识别 Helm 常用归属标记并沿 ownerReferences 补全下级资源',()=>{
 assert.deepEqual(containerResourceOwnerHints({labels:{'app.kubernetes.io/instance':'demo','app.kubernetes.io/name':'frontend'},annotations:{'meta.helm.sh/release-name':'demo'}}),{releaseNames:['demo'],appNames:['frontend']});
 const records=[{id:'deployment/demo',parentIds:[],owners:new Set(['helm:demo'])},{id:'replicaset/demo-1',parentIds:['deployment/demo'],owners:new Set<string>()},{id:'pod/demo-1-a',parentIds:['replicaset/demo-1'],owners:new Set<string>()}];
 propagateContainerResourceOwners(records);assert.deepEqual([...records[1]!.owners],['helm:demo']);assert.deepEqual([...records[2]!.owners],['helm:demo']);
});
