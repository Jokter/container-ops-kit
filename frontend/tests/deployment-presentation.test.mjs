import assert from 'node:assert/strict'
import test from 'node:test'

import {canConvertFailedQuickDeploymentToReview, canDeployReviewedTask, deploymentReviewBlockers} from '../src/deployment-presentation.js'

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

test('审阅部署明确列出未解析占位符', () => {
  const task = {mode: 'REVIEW', status: 'AWAITING_REVIEW', services: {
    swmfrontendservice: {stage: 'ANALYZED', values: 'image: repo/swm:{version:swmfrontendservice}', errors: []}
  }}
  assert.equal(canDeployReviewedTask(task), false)
  assert.deepEqual(deploymentReviewBlockers(task), [
    'swmfrontendservice：仍有未解析占位符 {version:swmfrontendservice}'
  ])
})

test('占位符全部解决后允许确认部署', () => {
  const task = {mode: 'REVIEW', status: 'AWAITING_REVIEW', services: {
    swmfrontendservice: {stage: 'ANALYZED', values: 'image: repo/swm:1.2.3', errors: []}
  }}
  assert.equal(canDeployReviewedTask(task), true)
  assert.deepEqual(deploymentReviewBlockers(task), [])
})
