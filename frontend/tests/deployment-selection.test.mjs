import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadDeploymentSelection,
  saveDeploymentSelection
} from '../src/deployment-selection.js'

class 内存存储 {
  数据 = new Map()

  getItem(键) {
    return this.数据.get(键) ?? null
  }

  setItem(键, 值) {
    this.数据.set(键, 值)
  }
}

test('每个容器环境和模块分别保存部署选择', () => {
  const 存储 = new 内存存储()
  saveDeploymentSelection(存储, {environmentId: 1, module: 'mae-a', namespace: 'dev', services: ['service-a']})
  saveDeploymentSelection(存储, {environmentId: 1, module: 'mae-b', namespace: 'test', services: ['service-b']})

  assert.deepEqual(loadDeploymentSelection(存储, 1, 'mae-a'), {
    environmentId: 1,
    module: 'mae-a',
    namespace: 'dev',
    services: ['service-a']
  })
  assert.deepEqual(loadDeploymentSelection(存储, 1, 'mae-b'), {
    environmentId: 1,
    module: 'mae-b',
    namespace: 'test',
    services: ['service-b']
  })
  assert.equal(loadDeploymentSelection(存储, 2, 'mae-a'), null)
})
