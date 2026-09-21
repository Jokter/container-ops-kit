import assert from 'node:assert/strict';
import test from 'node:test';
import {containerKubectlCommand,containerNamespaceNames} from '../src/modules/containerresource/containerresource.js';
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
