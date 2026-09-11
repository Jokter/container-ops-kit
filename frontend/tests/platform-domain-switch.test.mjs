import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const 页面路径 = new URL('../../index.html', import.meta.url)
const 页面 = await readFile(页面路径, 'utf8')

function 打开页面(请求) {
  return new JSDOM(页面, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(窗口) {
      窗口.scrollTo = () => {}
      if (请求) 窗口.fetch = 请求
    }
  })
}

function 等待界面更新() {
  return new Promise(完成 => setTimeout(完成, 0))
}

test('正式页面可以在三个平台域之间切换', () => {
  const 页面实例 = 打开页面()
  const 文档 = 页面实例.window.document

  assert.deepEqual(
    [...文档.querySelectorAll('[data-platform-domain]')].map(入口 => 入口.dataset.platformDomain),
    ['container', 'virtualization', 'automation']
  )

  文档.querySelector('[data-platform-domain="virtualization"]').click()
  assert.equal(文档.querySelector('.platform-placeholder h1').textContent, '虚拟化')
  assert.equal(文档.querySelector('.variant-a-nav'), null)

  文档.querySelector('[data-platform-domain="automation"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, '自动化工具')
  assert.equal(文档.querySelector('[data-automation-capability="auto-ut"] h2').textContent, 'Auto-UT')

  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, 'Auto-UT')
  assert.ok(文档.querySelector('#auto-ut-report'))
  assert.equal(文档.querySelector('#auto-ut-username').value, '')
  assert.equal(文档.querySelector('#auto-ut-ticket').value, '')
  assert.equal(文档.querySelector('#auto-ut-base-branch').value, '')
  assert.equal(文档.querySelector('#auto-ut-username').getAttribute('placeholder'), null)
  assert.equal(文档.querySelector('#auto-ut-ticket').getAttribute('placeholder'), null)
  assert.equal(文档.querySelector('#auto-ut-base-branch').getAttribute('placeholder'), null)
  assert.ok(文档.querySelector('[data-auto-ut-workspace-picker]'))
  assert.ok(文档.querySelector('[data-auto-ut-mode-switch]'))
  assert.equal(文档.querySelector('[data-auto-ut-mode-switch]').getAttribute('aria-checked'), 'false')
  assert.ok(文档.querySelector('#auto-ut-daily-time'))
  assert.ok(文档.querySelector('[data-auto-ut-schedule-toggle]'))
  assert.ok(页面.includes('data-auto-ut-directory-dialog'))
  assert.ok(页面.includes('data-auto-ut-progress'))
  assert.ok(页面.includes('data-auto-ut-continue'))

  页面实例.window.close()
})

test('切回容器化后恢复离开前的页面', () => {
  const 页面实例 = 打开页面()
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-page="build"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, '构建')

  文档.querySelector('[data-platform-domain="virtualization"]').click()
  文档.querySelector('[data-platform-domain="container"]').click()

  assert.equal(文档.querySelector('.page-head h1').textContent, '构建')
  assert.equal(文档.querySelector('[data-page="build"]').classList.contains('active'), true)

  页面实例.window.close()
})

test('工作目录从此电脑开始在网页内选择', async () => {
  const 请求 = async 地址 => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => []}
    if (地址 === '/api/auto-ut/schedule') return {ok: true, status: 204}
    if (地址.includes('?path=')) return {ok: true, status: 200, json: async () => ({current: 'E:\\', parent: '', writable: true, directories: []})}
    return {ok: true, status: 200, json: async () => ({current: '', parent: '', writable: false, directories: [{name: 'E:\\', path: 'E:\\', writable: true}]})}
  }
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await 等待界面更新()
  文档.querySelector('[data-auto-ut-workspace-picker]').click()
  await 等待界面更新()

  assert.equal(文档.querySelector('[data-auto-ut-directory-dialog] strong').textContent, '此电脑')
  文档.querySelector('[data-auto-ut-directory-path]').click()
  await 等待界面更新()
  文档.querySelector('[data-auto-ut-directory-select]').click()
  assert.match(文档.querySelector('[data-auto-ut-workspace-picker]').textContent, /E:/)

  页面实例.window.close()
})

test('外部错误任务可以从页面重试当前阶段', async () => {
  const 任务 = {
    id: 'task-1', repository: 'coder', status: 'WAITING_EXTERNAL', nextStage: 'BASELINE', progress: 25,
    message: '无法执行 mvn', repairBranch: 'master_test_user_ticket', workspaceRoot: 'E:\\AutoUT', history: []
  }
  const 请求 = async 地址 => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => [任务]}
    if (地址 === '/api/auto-ut/schedule') return {ok: true, status: 204}
    return {ok: true, status: 200, json: async () => ({})}
  }
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await 等待界面更新()

  assert.match(文档.querySelector('[data-auto-ut-continue="task-1"]').textContent, /重试/)

  页面实例.window.close()
})

test('项目进度只显示每个仓库的最新任务和当前信息', async () => {
  const 最新任务 = {
    id: 'new-task', repository: 'coder', status: 'REPAIRING', nextStage: 'REPAIR', progress: 45,
    message: '正在执行 Pi 修复。', repairBranch: 'master_test_user_ticket', workspaceRoot: 'E:\\AutoUT',
    createdAt: '2026-09-11T00:08:00Z', history: [{message: '不应显示的历史信息'}]
  }
  const 旧任务 = {...最新任务, id: 'old-task', message: '旧任务错误', createdAt: '2026-09-10T00:08:00Z'}
  const 请求 = async 地址 => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => [最新任务, 旧任务]}
    if (地址 === '/api/auto-ut/schedule') return {ok: true, status: 204}
    return {ok: true, status: 200, json: async () => ({})}
  }
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await 等待界面更新()

  assert.equal(文档.querySelectorAll('[data-auto-ut-task]').length, 1)
  assert.match(文档.querySelector('[data-auto-ut-task]').textContent, /正在执行 Pi 修复/)
  assert.doesNotMatch(文档.querySelector('[data-auto-ut-task]').textContent, /旧任务错误|不应显示的历史信息/)

  页面实例.window.close()
})
