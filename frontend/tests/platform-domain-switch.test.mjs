import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const 页面路径 = new URL('../../index.html', import.meta.url)
const 页面 = await readFile(页面路径, 'utf8')
const 项目配置 = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))

function 打开页面(请求, 事件源) {
  return new JSDOM(页面, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(窗口) {
      窗口.scrollTo = () => {}
      if (请求) 窗口.fetch = 请求
      if (事件源) 窗口.EventSource = 事件源
    }
  })
}

function 等待界面更新() {
  return new Promise(完成 => setTimeout(完成, 0))
}

test('左下角展示与项目配置一致的版本号', () => {
  const 页面实例 = 打开页面()
  assert.equal(页面实例.window.document.querySelector('.variant-a-user').textContent.trim(), `V${项目配置.version}`)
  assert.doesNotMatch(页面实例.window.document.querySelector('.variant-a-user').textContent, /林工|本地环境/)
  页面实例.window.close()
})

test('正式页面可以在三个平台域之间切换', () => {
  const 页面实例 = 打开页面()
  const 文档 = 页面实例.window.document

  assert.deepEqual(
    [...文档.querySelectorAll('[data-platform-domain]')].map(入口 => 入口.dataset.platformDomain),
    ['container', 'virtualization', 'automation']
  )
  assert.equal(文档.querySelector('.platform-switch').tagName, 'NAV')
  assert.equal(文档.querySelector('[data-platform-domain="container"]').getAttribute('aria-current'), 'page')
  文档.querySelector('[data-page="resources"]').click()
  assert.equal(文档.querySelector('.environment-version-card label').textContent, '版本')
  assert.doesNotMatch(文档.querySelector('.environment-version-card').textContent, /当前发布版本/)

  文档.querySelector('[data-platform-domain="virtualization"]').click()
  assert.equal(文档.querySelector('.platform-placeholder h1').textContent, '虚拟化')
  assert.equal(文档.querySelector('.variant-a-nav'), null)

  文档.querySelector('[data-platform-domain="automation"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, '自动化工具')
  assert.equal(文档.querySelector('[data-automation-capability="auto-ut"] h2').textContent, 'UT 自动修复')

  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, 'UT 自动修复')
  assert.equal(文档.querySelector('[data-report-source="csv"]'), null)
  assert.equal(文档.querySelector('#auto-ut-report'), null)
  assert.ok(文档.querySelector('[data-report-fetch]'))
  文档.querySelector('[data-qw-drawer="execution"]').click()
  assert.equal(文档.querySelector('#auto-ut-username').value, '')
  assert.equal(文档.querySelector('#auto-ut-ticket').value, '')
  assert.equal(文档.querySelector('#auto-ut-username').getAttribute('placeholder'), null)
  assert.equal(文档.querySelector('#auto-ut-ticket').getAttribute('placeholder'), null)
  assert.ok(文档.querySelector('[data-auto-ut-workspace-picker]'))
  文档.querySelector('[data-qw-close]').click()
  assert.equal(文档.querySelector('[data-auto-ut-mode-switch]'), null)
  assert.match(文档.body.textContent, /全自动执行/)
  assert.doesNotMatch(文档.body.textContent, /报告数据日期/)
  assert.match(文档.body.textContent, /自动获取最新数据/)
  assert.ok(文档.querySelector('[data-schedule-new="auto-ut"]'))
  assert.ok(文档.querySelector('[data-automation-nav="schedules"]'))
  assert.ok(页面.includes('data-auto-ut-directory-dialog'))
  assert.ok(页面.includes('ut-task-progress'))
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
    if (地址.includes('missing')) return {ok: false, status: 400, json: async () => ({message: '目录不存在'})}
    if (地址.includes('?path=')) return {ok: true, status: 200, json: async () => ({current: decodeURIComponent(地址.split('path=')[1]), parent: '', writable: true, directories: []})}
    return {ok: true, status: 200, json: async () => ({current: '', parent: '', writable: false, directories: [{name: 'E:\\', path: 'E:\\', writable: true}]})}
  }
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await 等待界面更新()
  文档.querySelector('[data-qw-drawer="execution"]').click()
  文档.querySelector('[data-auto-ut-workspace-picker]').click()
  await 等待界面更新()

  assert.equal(文档.querySelector('[data-auto-ut-directory-dialog] strong').textContent, '此电脑')
  let 路径输入 = 文档.querySelector('#auto-ut-directory-path-input')
  路径输入.value = 'missing'
  文档.querySelector('[data-auto-ut-directory-go]').dispatchEvent(new 页面实例.window.Event('submit', {bubbles: true, cancelable: true}))
  await 等待界面更新()
  assert.match(文档.querySelector('[role="alert"]').textContent, /目录不存在/)
  路径输入 = 文档.querySelector('#auto-ut-directory-path-input')
  路径输入.value = 'E:\\AutoUT'
  文档.querySelector('[data-auto-ut-directory-go]').dispatchEvent(new 页面实例.window.Event('submit', {bubbles: true, cancelable: true}))
  await 等待界面更新()
  assert.equal(文档.querySelector('#auto-ut-directory-title').textContent, 'E:\\AutoUT')
  assert.match(文档.querySelector('[data-auto-ut-directory-select]').textContent, /使用当前目录/)
  文档.querySelector('[data-auto-ut-directory-select]').click()
  assert.match(文档.querySelector('[data-auto-ut-workspace-picker]').textContent, /AutoUT/)

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

  文档.querySelector('[data-qw-auto-tab="tasks"]').click()
  assert.match(文档.querySelector('[data-auto-ut-continue="task-1"]').textContent, /重试/)

  页面实例.window.close()
})

test('在线报告使用默认CodeHub仓库且修改后保存映射', async () => {
  let 保存请求
  const 默认地址 = 'ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/FMInsightService.git'
  const 修改地址 = 'ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Special/FMInsightService.git'
  const 配置 = {versions: [{version: 'R27C10', baseBranch: 'develop'}], dateMode: 'yesterday', username: 'user', ticket: 'DTS1', workspaceRoot: 'E:\\AutoUT', schedule: {enabled: false, frequency: 'weekdays', weekday: 1, time: '09:00', timezone: 'Asia/Shanghai', action: 'FETCH'}}
  const 运行 = {id: 'r1', jobId: 'q1', status: 'READY', createdAt: 'now', config: 配置, trigger: 'MANUAL', messages: [], claimed: [], taskIds: [], plan: [{version: 'R27C10', repository: 'FMInsightService', failedTests: 2, lineCoverage: .75, lineGoal: .8, branchCoverage: .6, branchGoal: .7, baseBranch: 'develop', configured: true, repositoryUrl: 默认地址, repositoryCustomized: false, repairBranch: 'develop_user_DTS1_R27C10'}]}
  const 请求 = async (地址, 选项 = {}) => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => []}
    if (地址 === '/api/auto-ut/report-settings') return {ok: true, status: 200, json: async () => 选项.method === 'PUT' ? {config: JSON.parse(选项.body), nextRunAt: null} : {config: 配置, nextRunAt: null}}
    if (地址 === '/api/auto-ut/reports') return {ok: true, status: 200, json: async () => 选项.method === 'POST' ? 运行 : []}
    if (地址.includes('/api/auto-ut/repositories/')) {
      保存请求 = JSON.parse(选项.body)
      return {ok: true, status: 200, json: async () => ({repository: 'FMInsightService', url: 保存请求.url, customized: true})}
    }
    return {ok: true, status: 200, json: async () => []}
  }
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document
  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await 等待界面更新()
  await 等待界面更新()
  文档.querySelector('[data-report-fetch]').click()
  await 等待界面更新()
  await 等待界面更新()

  文档.querySelector('[data-qw-repository]').click()
  const 仓库输入 = 文档.querySelector('[data-auto-ut-repository-url="FMInsightService"]')
  assert.equal(仓库输入.value, 默认地址)
  assert.match(文档.querySelector('[data-auto-ut-repository-save="FMInsightService"]').parentElement.parentElement.textContent, /默认仓库/)
  仓库输入.value = 修改地址
  文档.querySelector('[data-auto-ut-repository-save="FMInsightService"]').click()
  await 等待界面更新()

  assert.equal(保存请求.url, 修改地址)
  assert.match(文档.querySelector('[data-auto-ut-repository-save="FMInsightService"]').parentElement.parentElement.textContent, /已保存/)
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

  文档.querySelector('[data-qw-auto-tab="tasks"]').click()
  assert.equal(文档.querySelectorAll('[data-auto-ut-task]').length, 1)
  assert.match(文档.querySelector('[data-auto-ut-task]').textContent, /正在执行 Pi 修复/)
  assert.doesNotMatch(文档.querySelector('[data-auto-ut-task]').textContent, /旧任务错误|不应显示的历史信息/)

  页面实例.window.close()
})

test('Pi思考和回复实时展示且回复开始后折叠思考', async () => {
  const 任务 = {
    id: 'task-live', repository: 'coder', status: 'REPAIRING', nextStage: 'REPAIR', progress: 45,
    message: '正在执行 Pi 修复。', repairBranch: 'repair', workspaceRoot: 'E:\\AutoUT', createdAt: '2026-09-11T00:08:00Z'
  }
  class 模拟事件源 {
    static instances = []
    constructor(url) { this.url = url; 模拟事件源.instances.push(this) }
    close() {}
    emit(event) { this.onmessage?.({data: JSON.stringify(event)}) }
  }
  const 请求 = async 地址 => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => [任务]}
    if (地址 === '/api/auto-ut/schedule') return {ok: true, status: 204}
    return {ok: true, status: 200, json: async () => ({})}
  }
  const 页面实例 = 打开页面(请求, 模拟事件源)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await new Promise(完成 => setTimeout(完成, 10))
  文档.querySelector('[data-qw-auto-tab="tasks"]').click()
  assert.match(模拟事件源.instances[0].url, /task-live\/events/)

  模拟事件源.instances[0].emit({sequence: 1, type: 'prompt', content: '只修改测试代码并修复失败用例', toolCallId: 'attempt-1'})
  模拟事件源.instances[0].emit({sequence: 2, type: 'thinking_start'})
  模拟事件源.instances[0].emit({sequence: 3, type: 'thinking_delta', content: '正在定位失败用例'})
  await new Promise(完成 => setTimeout(完成, 160))
  assert.match(文档.querySelector('[data-auto-ut-live="task-live"]').textContent, /发送给 Pi 的任务.*第 1 轮/)
  assert.match(文档.querySelector('[data-auto-ut-live="task-live"]').textContent, /只修改测试代码并修复失败用例/)
  assert.equal(文档.querySelector('[data-auto-ut-thinking="task-live"]').open, true)
  assert.match(文档.querySelector('[data-auto-ut-thinking="task-live"]').textContent, /正在定位失败用例/)

  模拟事件源.instances[0].emit({sequence: 4, type: 'message_start'})
  模拟事件源.instances[0].emit({sequence: 5, type: 'message_delta', content: '已修复测试'})
  await new Promise(完成 => setTimeout(完成, 160))
  assert.equal(文档.querySelector('[data-auto-ut-thinking="task-live"]').open, false)
  assert.match(文档.querySelector('[data-auto-ut-live="task-live"]').textContent, /已修复测试/)

  页面实例.window.close()
})

test('刷新任务列表后恢复已保存的 Pi 交互记录', async () => {
  const 任务 = {
    id: 'task-history', repository: 'coder', status: 'RESOLVED', nextStage: 'DONE', progress: 100,
    message: '任务已完成。', repairBranch: 'repair', workspaceRoot: 'E:\\AutoUT',
    liveEvents: [
      {sequence: 1, type: 'prompt', content: '修复两个失败用例', toolCallId: 'attempt-1'},
      {sequence: 2, type: 'thinking_delta', content: '检查失败堆栈'},
      {sequence: 3, type: 'message_delta', content: '修复完成并通过验证'}
    ]
  }
  const 请求 = async 地址 => 地址 === '/api/auto-ut/tasks'
    ? {ok: true, status: 200, json: async () => [任务]}
    : {ok: true, status: 200, json: async () => ({})}
  const 页面实例 = 打开页面(请求)
  const 文档 = 页面实例.window.document
  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await new Promise(完成 => setTimeout(完成, 160))
  文档.querySelector('[data-qw-auto-tab="tasks"]').click()
  const 面板 = 文档.querySelector('[data-auto-ut-live="task-history"]')
  assert.match(面板.textContent, /修复两个失败用例/)
  assert.match(面板.textContent, /检查失败堆栈/)
  assert.match(面板.textContent, /修复完成并通过验证/)
  页面实例.window.close()
})

test('基线阶段展示细分流程且不提前显示Pi等待内容', async () => {
  const 任务 = {
    id: 'task-baseline', repository: 'FMInsightService', status: 'BASELINE_RUNNING', nextStage: 'BASELINE', progress: 25,
    message: '正在执行基线 UT。', repairBranch: 'master_user_ticket', workspaceRoot: 'D:\\Projects\\HWTest'
  }
  class 模拟事件源 {
    static instances = []
    constructor() { 模拟事件源.instances.push(this) }
    close() {}
    emit(event) { this.onmessage?.({data: JSON.stringify(event)}) }
  }
  const 请求 = async 地址 => {
    if (地址 === '/api/auto-ut/tasks') return {ok: true, status: 200, json: async () => [任务]}
    if (地址 === '/api/auto-ut/schedule') return {ok: true, status: 204}
    return {ok: true, status: 200, json: async () => ({})}
  }
  const 页面实例 = 打开页面(请求, 模拟事件源)
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-platform-domain="automation"]').click()
  文档.querySelector('[data-automation-capability="auto-ut"]').click()
  await new Promise(完成 => setTimeout(完成, 10))
  文档.querySelector('[data-qw-auto-tab="tasks"]').click()
  模拟事件源.instances[0].emit({
    sequence: 1, type: 'operation_start', content: '基线测试', toolCallId: 'operation-1', toolName: 'mvn -B -ntp clean test'
  })
  await new Promise(完成 => setTimeout(完成, 160))

  const 实时面板 = 文档.querySelector('[data-auto-ut-live="task-baseline"]')
  assert.match(实时面板.textContent, /基线测试.*执行中/)
  assert.match(实时面板.textContent, /mvn -B -ntp clean test/)
  assert.doesNotMatch(实时面板.textContent, /等待 Pi 输出|等待 Pi 回复|等待模型/)

  页面实例.window.close()
})
