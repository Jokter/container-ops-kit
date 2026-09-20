import assert from 'node:assert/strict'
import test from 'node:test'

import {canConvertFailedQuickDeploymentToReview, canDeployReviewedTask, deploymentProgress, deploymentReviewBlockers, deploymentReviewWarnings} from '../src/deployment-presentation.js'

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

test('审阅部署将未解析镜像版本作为非阻塞警告', () => {
  const task = {mode: 'REVIEW', status: 'AWAITING_REVIEW', services: {
    swmfrontendservice: {stage: 'ANALYZED', values: 'image: repo/swm:{version:swmfrontendservice}', errors: []}
  }}
  assert.equal(canDeployReviewedTask(task), true)
  assert.deepEqual(deploymentReviewBlockers(task), [])
  assert.deepEqual(deploymentReviewWarnings(task), [
    'swmfrontendservice：未找到 {version:swmfrontendservice}，作为可选配置继续，后续由 Helm 渲染校验'
  ])
})

test('普通未解析占位符仍然阻塞审阅部署', () => {
  const task = {mode: 'REVIEW', status: 'AWAITING_REVIEW', services: {
    swmfrontendservice: {stage: 'ANALYZED', values: 'image: replaceByOssDiy', errors: []}
  }}
  assert.equal(canDeployReviewedTask(task), false)
  assert.deepEqual(deploymentReviewBlockers(task), ['swmfrontendservice：仍有未解析占位符 replaceByOssDiy'])
})

test('占位符全部解决后允许确认部署', () => {
  const task = {mode: 'REVIEW', status: 'AWAITING_REVIEW', services: {
    swmfrontendservice: {stage: 'ANALYZED', values: 'image: repo/swm:1.2.3', errors: []}
  }}
  assert.equal(canDeployReviewedTask(task), true)
  assert.deepEqual(deploymentReviewBlockers(task), [])
  assert.deepEqual(deploymentReviewWarnings(task), [])
})

test('部署日志映射为清晰的阶段进度', () => {
  assert.deepEqual(deploymentProgress({status: 'PREPARING'}, [{stage: 'RENDER', service: 'swmfrontendservice', message: 'Helm 渲染校验通过'}]), {percent: 55, label: 'swmfrontendservice · 正在执行 Helm 渲染校验'})
  assert.deepEqual(deploymentProgress({status: 'DEPLOYING'}, [{stage: 'DEPLOY', service: 'swmfrontendservice', message: '[4/5] 安装 Helm release'}]), {percent: 87, label: 'swmfrontendservice · 安装 Helm release'})
})
