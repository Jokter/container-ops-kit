import assert from 'node:assert/strict'
import test from 'node:test'

import {canConvertFailedQuickDeploymentToReview} from '../src/deployment-presentation.js'

test('仅有未解析镜像时允许将失败的快速部署转为审阅部署', () => {
  assert.equal(canConvertFailedQuickDeploymentToReview({
    mode: 'QUICK',
    status: 'FAILED',
    services: {
      'service-a': {unresolvedImages: ['service-a'], errors: []}
    }
  }), true)
})

test('同时存在阻断错误时不允许转为审阅部署', () => {
  assert.equal(canConvertFailedQuickDeploymentToReview({
    mode: 'QUICK',
    status: 'FAILED',
    services: {
      'service-a': {unresolvedImages: ['service-a'], errors: []},
      'service-b': {unresolvedImages: [], errors: ['读取远端 Chart 失败']}
    }
  }), false)
})
