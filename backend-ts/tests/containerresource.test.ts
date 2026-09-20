import assert from 'node:assert/strict';
import test from 'node:test';
import {containerKubectlCommand} from '../src/modules/containerresource/containerresource.js';

test('容器资源命令统一使用部署环境的 kubeconfig 且不会重复 kubectl', () => {
  const command=containerKubectlCommand("get 'deployments.apps' -n 'mae' -o json");
  assert.equal(command,"kubectl --kubeconfig=/opt/kubeconfig/kubeconfig.txt get 'deployments.apps' -n 'mae' -o json");
  assert.equal((command.match(/\bkubectl\b/g)??[]).length,1);
});
