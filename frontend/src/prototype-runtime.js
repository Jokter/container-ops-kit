(function () {
  const statusMap = {UNTESTED: 'untested', REACHABLE: 'online', FAILED: 'error'}
  const typeMap = {BUILD: 'build', CONTAINER: 'container'}

  async function request(url, options) {
    const response = await fetch(url, Object.assign({headers: {'Content-Type': 'application/json'}}, options || {}))
    if (!response.ok) {
      const body = await response.json().catch(() => ({message: '请求失败'}))
      throw new Error(body.message || '请求失败')
    }
    return response.status === 204 ? null : response.json()
  }

  function mapEnvironment(item) {
    return {
      id: 'db-' + item.id,
      _apiId: item.id,
      _version: item.version,
      type: typeMap[item.type],
      version: 'dbv-' + item.releaseVersion.id,
      name: item.name,
      ip: item.host,
      port: String(item.sshPort),
      user: item.type === 'BUILD' ? 'huawei' : 'sopuser',
      password: item.password,
      rootPassword: item.rootPassword || '',
      workdir: item.workDirectory || '',
      architecture: (item.architecture || '').toLowerCase(),
      businessPlaneUrl: item.businessPlaneUrl || '',
      businessPlaneUser: item.businessPlaneUser || '',
      businessPlanePassword: item.businessPlanePassword || '',
      managementPlaneUrl: item.managementPlaneUrl || '',
      managementPlaneUser: item.managementPlaneUser || '',
      managementPlanePassword: item.managementPlanePassword || '',
      sshPasswordConfigured: Boolean(item.password),
      rootPasswordConfigured: Boolean(item.rootPassword),
      status: statusMap[item.connectionStatus],
      lastTest: item.lastTestedAt ? new Date(item.lastTestedAt).toLocaleString('zh-CN') : '尚未测试',
      latency: item.lastTestLatencyMs != null ? item.lastTestLatencyMs + ' ms' : item.lastTestError || '—',
      outcome: statusMap[item.connectionStatus]
    }
  }

  function selectedSshUser(environment) {
    if (environment.type === 'build') return 'HUAWEI'
    const selector = document.querySelector('[data-test-user="' + environment.id + '"]')
    return selector?.value || 'SOPUSER'
  }

  function username(user) {
    return {HUAWEI: 'huawei', SOPUSER: 'sopuser', ROOT: 'root'}[user]
  }

  function normalizeAddress(address) {
    if (!address) return ''
    try {
      const candidate = /^https?:\/\//i.test(address) ? address : 'http://' + address
      const parsed = new URL(candidate)
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
    } catch {
      return ''
    }
  }

  function serviceCell(environment, prefix, label) {
    const address = environment[prefix + 'Url']
    if (!address) return '<div data-label="' + label + '"><span class="environment-cell-copy">—</span></div>'
    const url = normalizeAddress(address)
    const user = environment[prefix + 'User'] || '—'
    const password = environment[prefix + 'Password'] || '—'
    const addressHtml = url
      ? '<a class="service-address mono" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(address) + '</a>'
      : '<strong class="mono">' + escapeHtml(address) + '</strong>'
    return '<div class="service-cell" data-label="' + label + '">' + addressHtml
      + '<span class="credential-line"><span>账号 ' + escapeHtml(user) + '</span><button type="button" data-copy-credential="' + prefix + 'User" data-environment-id="' + environment.id + '">复制</button></span>'
      + '<span class="credential-line"><span>密码 ' + escapeHtml(password) + '</span><button type="button" data-copy-credential="' + prefix + 'Password" data-environment-id="' + environment.id + '">复制</button></span></div>'
  }

  function sshCell(environment) {
    const rootLine = environment.type === 'container'
      ? '<span class="credential-line"><span>root / ' + escapeHtml(environment.rootPassword || '未配置') + '</span></span>'
      : ''
    return '<div data-label="SSH 地址"><strong class="mono">' + escapeHtml(environment.ip) + ':' + escapeHtml(environment.port) + '</strong>'
      + '<span class="credential-line"><span>' + escapeHtml(environment.user) + ' / ' + escapeHtml(environment.password) + '</span></span>' + rootLine + '</div>'
  }

  const originalEnvironmentEditor = environmentEditor
  environmentEditor = function () {
    if (state.resourceDrawer?.mode === 'history') state.resourceDrawer = null
    return originalEnvironmentEditor()
  }

  environmentTable = function () {
    const items = visibleEnvironments()
    const locked = selectedReleaseVersion().locked
    if (!items.length) {
      return '<div class="environment-empty"><h2>没有匹配的环境</h2><p style="margin-top:5px">' + (locked ? '历史版本为只读，可调整筛选条件查看已有环境。' : '调整筛选条件，或在当前发布版本下新增环境。') + '</p></div>'
    }
    const container = state.resourceType === 'container'
    const head = container
      ? '<div class="environment-row container-row head"><span>环境</span><span>SSH 地址</span><span>业务面</span><span>管理面</span><span>系统架构</span><span>连接状态</span><span>最近测试</span><span style="text-align:right">操作</span></div>'
      : '<div class="environment-row head"><span>环境</span><span>SSH 地址</span><span>系统架构</span><span>连接状态</span><span>最近测试</span><span style="text-align:right">操作</span></div>'
    const rows = items.map(item => {
      const unavailable = locked || Boolean(state.batch) || Boolean(testTokens.size)
      const name = '<div class="environment-row-name"><span class="environment-kind-icon">' + (item.type === 'build' ? '构' : '容') + '</span><div><strong>' + escapeHtml(item.name) + '</strong><span class="mono">' + escapeHtml(item.workdir) + '</span></div></div>'
      const architecture = '<div data-label="系统架构"><span class="badge ' + (item.architecture === 'aarch64' ? 'violet' : 'brand') + '">' + (item.architecture === 'aarch64' ? 'ARM' : 'x86') + '</span></div>'
      const connectionStatus = '<div data-label="连接状态">' + environmentStatus(item) + '</div>'
      const lastTest = '<div data-label="最近测试"><strong>' + escapeHtml(item.lastTest) + '</strong><span class="environment-cell-copy">' + escapeHtml(item.latency) + '</span></div>'
      const userSelector = item.type === 'container'
        ? '<select class="environment-filter compact" data-test-user="' + item.id + '" aria-label="测试账号"><option value="SOPUSER">sopuser</option><option value="ROOT" ' + (item.rootPasswordConfigured ? '' : 'disabled') + '>root' + (item.rootPasswordConfigured ? '' : '（未配置）') + '</option></select>'
        : ''
      const actions = '<div class="environment-actions">' + userSelector + '<button class="button small" data-test-environment="' + item.id + '" ' + (unavailable ? 'disabled' : '') + '>测试连接</button><button class="button small ghost" data-edit-environment="' + item.id + '" ' + (unavailable ? 'disabled' : '') + '>编辑</button><select class="environment-filter" data-more-environment="' + item.id + '" aria-label="更多操作" ' + (unavailable ? 'disabled' : '') + '><option value="">更多</option><option value="copy">复制 SSH 命令</option><option value="delete">删除环境</option></select></div>'
      if (container) return '<div class="environment-row container-row">' + name + sshCell(item) + serviceCell(item, 'businessPlane', '业务面') + serviceCell(item, 'managementPlane', '管理面') + architecture + connectionStatus + lastTest + actions + '</div>'
      return '<div class="environment-row">' + name + sshCell(item) + architecture + connectionStatus + lastTest + actions + '</div>'
    }).join('')
    return '<div class="environment-table">' + head + rows + '</div>'
  }

  async function loadResources() {
    try {
      const result = await Promise.all([request('/api/release-versions'), request('/api/environments')])
      releaseVersions.splice(0, releaseVersions.length, ...result[0].map(item => ({id: 'dbv-' + item.id, _apiId: item.id, code: item.code, name: item.name, locked: false})))
      environments.splice(0, environments.length, ...result[1].map(mapEnvironment))
      if (releaseVersions.length && !releaseVersions.some(item => item.id === state.resourceVersion)) state.resourceVersion = releaseVersions[0].id
      render(false)
      if (state.page === 'build') loadBuildStorage()
    } catch (error) {
      releaseVersions.splice(0, releaseVersions.length)
      environments.splice(0, environments.length)
      state.resourceVersion = ''
      render(false)
      showToast((error.message || '资源中心加载失败') + '，请确认后端已启动')
    }
  }

  testEnvironment = async function (id) {
    const environment = environments.find(item => item.id === id)
    if (!environment || environment._apiId == null || testTokens.has(id)) {
      showToast('环境数据尚未从后端加载')
      return
    }
    const token = Symbol(id)
    const user = selectedSshUser(environment)
    testTokens.set(id, token)
    render(false)
    try {
      const result = await request('/api/environments/' + environment._apiId + '/connection-test', {method: 'POST', body: JSON.stringify({user})})
      environment.status = statusMap[result.status]
      environment.lastTest = '刚刚'
      environment.latency = result.latencyMs != null ? result.latencyMs + ' ms' : result.error || '—'
      showToast(result.status === 'REACHABLE' ? environment.name + '（' + username(user) + '）可以连接' : result.error || environment.name + ' 连接失败')
    } catch (error) {
      showToast(error.message || '连接测试失败')
    } finally {
      testTokens.delete(id)
      render(false)
    }
  }

  testAllEnvironments = async function () {
    const targets = versionEnvironments(state.resourceType).filter(item => item._apiId != null)
    if (!targets.length) {
      showToast('当前范围没有可测试的环境')
      return
    }
    targets.forEach(item => testTokens.set(item.id, Symbol(item.id)))
    render(false)
    const results = await Promise.all(targets.map(async environment => {
      try {
        const user = environment.type === 'build' ? 'HUAWEI' : 'SOPUSER'
        const result = await request('/api/environments/' + environment._apiId + '/connection-test', {method: 'POST', body: JSON.stringify({user})})
        environment.status = statusMap[result.status]
        environment.lastTest = '刚刚'
        environment.latency = result.latencyMs != null ? result.latencyMs + ' ms' : result.error || '—'
        return result.status === 'REACHABLE'
      } catch (error) {
        environment.status = 'error'
        environment.latency = error.message || '连接失败'
        return false
      } finally {
        testTokens.delete(environment.id)
      }
    }))
    render(false)
    showToast('测试完成：' + results.filter(Boolean).length + ' 个成功，' + results.filter(item => !item).length + ' 个失败')
  }

  function validateOptionalGroup(form, names, message) {
    const fields = names.map(name => form.elements[name])
    fields.forEach(field => field.setCustomValidity(''))
    const filled = fields.filter(field => field.value.trim())
    if (filled.length === 0 || filled.length === fields.length) return true
    const missing = fields.find(field => !field.value.trim())
    missing.setCustomValidity(message)
    missing.reportValidity()
    return false
  }

  saveEnvironment = async function () {
    const form = document.querySelector('#environment-form')
    if (!form || !form.reportValidity()) return
    if (form.dataset.environmentType === 'container') {
      if (!validateOptionalGroup(form, ['businessPlaneUrl', 'businessPlaneUser', 'businessPlanePassword'], '业务面地址、账号和密码需要同时填写')) return
      if (!validateOptionalGroup(form, ['managementPlaneUrl', 'managementPlaneUser', 'managementPlanePassword'], '管理面地址、账号和密码需要同时填写')) return
    }
    const values = Object.fromEntries(new FormData(form))
    const existing = environments.find(item => item.id === form.dataset.environmentId)
    const selectedVersion = releaseVersions.find(item => item.id === values.version)
    const type = form.dataset.environmentType
    if (!selectedVersion || selectedVersion._apiId == null) {
      showToast('发布版本数据尚未从后端加载')
      return
    }
    const body = {
      releaseVersionId: selectedVersion._apiId,
      type: type === 'build' ? 'BUILD' : 'CONTAINER',
      name: values.name,
      host: values.ip,
      sshPort: Number(values.port),
      password: values.password || existing?.password || '',
      rootPassword: type === 'container' ? values.rootPassword || existing?.rootPassword || '' : null,
      workDirectory: values.workdir || '',
      architecture: (values.architecture || '').toUpperCase(),
      businessPlaneUrl: values.businessPlaneUrl || '',
      businessPlaneUser: values.businessPlaneUser || '',
      businessPlanePassword: values.businessPlanePassword || existing?.businessPlanePassword || '',
      managementPlaneUrl: values.managementPlaneUrl || '',
      managementPlaneUser: values.managementPlaneUser || '',
      managementPlanePassword: values.managementPlanePassword || existing?.managementPlanePassword || '',
      version: existing ? existing._version : null
    }
    try {
      await request(existing ? '/api/environments/' + existing._apiId : '/api/environments', {method: existing ? 'PUT' : 'POST', body: JSON.stringify(body)})
      state.resourceDrawer = null
      await loadResources()
      showToast(existing ? '环境配置已保存' : '环境已新增')
    } catch (error) {
      showToast(error.message || '保存失败')
    }
  }

  deleteEnvironment = async function (environment) {
    if (!environment || environment._apiId == null || testTokens.has(environment.id)) {
      showToast('环境数据尚未从后端加载')
      return
    }
    if (!confirm('确定删除“' + environment.name + '”吗？删除后无法恢复。')) return
    try {
      await request('/api/environments/' + environment._apiId, {method: 'DELETE'})
      await loadResources()
      showToast('环境已删除')
    } catch (error) {
      showToast(error.message || '删除失败')
    }
  }

  async function previewConnection() {
    const form = document.querySelector('#environment-form')
    if (!form) return
    const values = Object.fromEntries(new FormData(form))
    const existing = environments.find(item => item.id === form.dataset.environmentId)
    const result = document.querySelector('#drawer-test-result')
    const button = document.querySelector('[data-drawer-test]')
    const user = form.dataset.environmentType === 'build' ? 'HUAWEI' : values.sshTestUser || 'SOPUSER'
    const password = user === 'ROOT' ? values.rootPassword || existing?.rootPassword || '' : values.password || existing?.password || ''
    const body = {user, host: values.ip, sshPort: Number(values.port), password}
    const passwordField = user === 'ROOT' ? form.elements.rootPassword : form.elements.password
    passwordField.setCustomValidity('')
    if (!body.host || !body.password) {
      passwordField.setCustomValidity('请输入 ' + username(user) + ' 密码')
      passwordField.reportValidity()
      return
    }
    result.className = 'drawer-test-result visible testing'
    result.textContent = '正在检查 ssh ' + username(user) + '@' + body.host + ' 的真实连接…'
    button.disabled = true
    try {
      const response = await request('/api/connection-tests/preview', {method: 'POST', body: JSON.stringify(body)})
      result.className = 'drawer-test-result visible ' + (response.status === 'REACHABLE' ? 'success' : 'error')
      result.textContent = response.status === 'REACHABLE' ? 'SSH 连接成功，可以保存当前配置。' : response.error || 'SSH 连接失败'
    } catch (error) {
      result.className = 'drawer-test-result visible error'
      result.textContent = error.message || 'SSH 连接失败'
    } finally {
      button.disabled = false
    }
  }

  function patchEnvironmentForm() {
    const form = document.querySelector('#environment-form')
    if (!form || form.dataset.runtimePatched) return
    form.dataset.runtimePatched = 'true'
    const existing = environments.find(item => item.id === form.dataset.environmentId)
    const containerFields = [
      ['mae', 'businessPlaneUrl', '业务面地址', 'https://141.71.43.65:31943'],
      ['maeUser', 'businessPlaneUser', '业务面账号', '请输入账号'],
      ['maePassword', 'businessPlanePassword', '业务面密码', '请输入密码'],
      ['osmu', 'managementPlaneUrl', '管理面地址', 'https://141.71.43.62:31945'],
      ['osmuUser', 'managementPlaneUser', '管理面账号', '请输入账号'],
      ['osmuPassword', 'managementPlanePassword', '管理面密码', '请输入密码']
    ]
    for (const [legacyName, name, label, placeholder] of containerFields) {
      const input = form.elements[legacyName]
      if (!input) continue
      input.name = name
      input.placeholder = placeholder
      input.closest('.field').querySelector('label').textContent = label
      if (name.endsWith('Url')) input.type = 'url'
      if (existing) input.value = existing[name] || ''
    }
    for (const name of ['password', 'businessPlanePassword', 'managementPlanePassword']) {
      const input = form.elements[name]
      if (input) {
        input.type = 'text'
        if (existing && !input.value) input.value = existing[name] || ''
      }
    }
    for (const name of ['businessPlaneUrl', 'businessPlaneUser', 'businessPlanePassword', 'managementPlaneUrl', 'managementPlaneUser', 'managementPlanePassword']) {
      form.elements[name]?.removeAttribute('required')
    }
    if (form.dataset.environmentType !== 'container') return
    const passwordField = form.elements.password.closest('.field')
    const rootUserField = document.createElement('div')
    rootUserField.className = 'field'
    rootUserField.innerHTML = '<label>固定用户</label><div class="readonly-value mono">root</div>'
    const rootPasswordField = document.createElement('div')
    rootPasswordField.className = 'field'
    rootPasswordField.innerHTML = '<label>密码</label><input name="rootPassword" type="text" required placeholder="请输入 root 密码">'
    passwordField.after(rootUserField, rootPasswordField)
    form.elements.rootPassword.value = existing?.rootPassword || ''
    form.addEventListener('input', event => event.target.setCustomValidity?.(''))
    const selector = document.createElement('select')
    selector.name = 'sshTestUser'
    selector.className = 'environment-filter'
    selector.setAttribute('aria-label', '测试账号')
    selector.innerHTML = '<option value="SOPUSER">测试 sopuser</option><option value="ROOT">测试 root</option>'
    document.querySelector('[data-drawer-test]')?.before(selector)
    const headerCopy = document.querySelector('.environment-drawer .drawer-header p')
    if (headerCopy) headerCopy.textContent = 'sopuser 与 root 使用同一 OM 节点地址，分别维护登录密码。'
  }

  async function copyText(value, message) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    showToast(message)
  }

  copySshCommand = function (environment) {
    const user = selectedSshUser(environment)
    const command = 'ssh ' + username(user) + '@' + environment.ip + ' -p ' + environment.port
    copyText(command, '已复制：' + command)
  }

  const buildRuntime = {
    configuration: null,
    task: null,
    history: [],
    storage: null,
    storageEnvironmentId: null,
    storageLoading: false,
    logs: [],
    logQuery: '',
    eventSource: null,
    sequences: new Set(),
    starting: false,
    latestMessage: '尚未开始构建'
  }

  const baseRender = render
  render = function (resetScroll = true) {
    const previousTerminal = document.querySelector('#build-log-terminal')
    const previousScrollTop = previousTerminal?.scrollTop || 0
    const followedLatest = previousTerminal
      ? previousTerminal.scrollHeight - previousTerminal.clientHeight - previousTerminal.scrollTop < 36
      : true
    baseRender(resetScroll)
    const nextTerminal = document.querySelector('#build-log-terminal')
    if (nextTerminal) nextTerminal.scrollTop = followedLatest ? nextTerminal.scrollHeight : previousScrollTop
  }

  buildTabs = function () {
    return '<div class="workspace-tabs"><button data-build-tab="single" class="' + (state.buildTab === 'single' ? 'active' : '') + '">单分支构建</button><button data-build-tab="compare" class="' + (state.buildTab === 'compare' ? 'active' : '') + '">双分支对比</button><button data-build-tab="history" class="' + (state.buildTab === 'history' ? 'active' : '') + '">历史任务</button><button data-build-tab="config" class="' + (state.buildTab === 'config' ? 'active' : '') + '">构建配置</button></div>'
  }

  function buildBranchField(repositoryLabel, repository, branchName, branchValue = '') {
    return '<div class="field"><label>' + repositoryLabel + '</label><input class="mono" value="' + escapeHtml(repository || '正在加载…') + '" readonly></div>'
      + '<div class="field"><label>分支</label><input name="' + branchName + '" value="' + escapeHtml(branchValue) + '" maxlength="200" required pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,199}"></div>'
  }

  function buildModuleField(configuration) {
    const modules = configuration?.modules || []
    return '<div class="field" style="grid-column:1/-1"><label>构建模块</label><select name="module" required>'
      + modules.map(item => '<option value="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</option>').join('')
      + '</select></div>'
  }

  singleBuildForm = function () {
    const configuration = buildRuntime.configuration
    return '<section class="panel"><div class="panel-head"><div><h2>构建输入</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">分支默认使用 master，可直接修改</p></div><span class="badge green">固定仓库</span></div><div class="panel-body"><form id="single-build-form"><div class="form-grid">'
      + buildModuleField(configuration)
      + buildBranchField('CBB-Web-Dev 仓库', configuration?.cbbWebDevRepository, 'cbbWebDevBranch', configuration?.defaultBranch)
      + buildBranchField('ArchDesign 仓库', configuration?.archDesignRepository, 'archDesignBranch', configuration?.defaultBranch)
      + '</div><div style="display:flex;justify-content:flex-end;align-items:center;margin-top:15px"><button type="button" class="button primary" data-create-build-task="single" ' + (buildRuntime.starting || !configuration ? 'disabled' : '') + '>开始构建</button></div></form></div></section>'
  }

  compareBuildForm = function () {
    const configuration = buildRuntime.configuration
    return '<form id="compare-build-form"><div class="resource-grid"><section class="panel"><div class="panel-head"><h2>基准版本 A</h2><span class="badge violet">左侧</span></div><div class="panel-body"><div class="form-grid">'
      + buildModuleField(configuration)
      + buildBranchField('CBB-Web-Dev 仓库', configuration?.cbbWebDevRepository, 'baselineCbbWebDevBranch', configuration?.defaultBranch)
      + buildBranchField('ArchDesign 仓库', configuration?.archDesignRepository, 'baselineArchDesignBranch', configuration?.defaultBranch)
      + '</div></div></section><section class="panel"><div class="panel-head"><h2>验证版本 B</h2><span class="badge green">右侧</span></div><div class="panel-body"><div class="form-grid">'
      + buildBranchField('CBB-Web-Dev 仓库', configuration?.cbbWebDevRepository, 'candidateCbbWebDevBranch', configuration?.defaultBranch)
      + buildBranchField('ArchDesign 仓库', configuration?.archDesignRepository, 'candidateArchDesignBranch', configuration?.defaultBranch)
      + '</div></div></section></div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button type="button" class="button primary" data-create-build-task="compare" ' + (buildRuntime.starting || !configuration ? 'disabled' : '') + '>并发构建并对比</button></div></form>'
  }

  buildConfig = function () {
    const configuration = buildRuntime.configuration
    const environment = environments.find(item => item.id === state.selectedBuildEnvironment) || environments.find(item => item.type === 'build')
    return '<div class="resource-grid"><section class="panel"><div class="panel-head"><h2>仓库与命令</h2><span class="badge green">系统固定</span></div><div class="panel-body"><div class="form-grid"><div class="field"><label>CBB-Web-Dev 仓库</label><input class="mono" value="' + escapeHtml(configuration?.cbbWebDevRepository || '正在加载…') + '" readonly></div><div class="field"><label>默认分支</label><input value="' + escapeHtml(configuration?.defaultBranch || '正在加载…') + '" readonly></div><div class="field"><label>ArchDesign 仓库</label><input class="mono" value="' + escapeHtml(configuration?.archDesignRepository || '正在加载…') + '" readonly></div><div class="field"><label>默认分支</label><input value="' + escapeHtml(configuration?.defaultBranch || '正在加载…') + '" readonly></div><div class="field" style="grid-column:1/-1"><label>构建命令</label><input class="mono" value="' + escapeHtml(configuration?.buildCommand || '正在加载…') + '" readonly></div></div></div></section><section class="panel"><div class="panel-head"><h2>当前构建环境</h2><button class="button small" data-page="resources">打开资源中心</button></div><div class="panel-body">' + (environment ? '<h3>' + escapeHtml(environment.name) + '</h3><p style="margin-top:6px;color:var(--muted)">' + escapeHtml(environment.workdir) + '</p><div class="connection-grid"><div class="connection"><span>SSH</span><strong class="mono">huawei@' + escapeHtml(environment.ip) + '</strong></div><div class="connection"><span>系统架构</span><strong>' + (environment.architecture === 'aarch64' ? 'ARM' : 'x86') + '</strong></div><div class="connection"><span>状态</span><strong class="status ' + statusPresentation[environment.status].className + '">' + statusPresentation[environment.status].label + '</strong></div></div>' : '<p style="color:var(--muted)">请先在资源中心新增构建环境。</p>') + '</div></section></div>'
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value < 1) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
    return (value / Math.pow(1024, index)).toFixed(index > 2 ? 1 : 2).replace(/\.00$/, '') + ' ' + units[index]
  }

  function buildStorageSummary() {
    const storage = buildRuntime.storage
    const environment = environments.find(item => item.id === state.selectedBuildEnvironment) || environments.find(item => item.type === 'build')
    const configuredPath = environment?.workdir || '未配置'
    if (buildRuntime.storageLoading) return '<section class="build-storage"><span>存储目录</span><strong class="mono">' + escapeHtml(configuredPath) + '</strong><span>正在读取…</span></section>'
    if (!storage) return '<section class="build-storage"><span>存储目录</span><strong class="mono">' + escapeHtml(configuredPath) + '</strong><span>暂不可用</span><button class="button small ghost" data-refresh-build-storage>重试</button></section>'
    return '<section class="build-storage"><span>存储目录</span><strong class="mono">' + escapeHtml(storage.path) + '</strong><span>目录占用 <b>' + formatBytes(storage.usedBytes) + '</b></span><span>文件系统可用 <b>' + formatBytes(storage.availableBytes) + '</b></span><span>使用率 <b>' + escapeHtml(storage.filesystemUsage) + '</b></span><button class="button small ghost" data-refresh-build-storage>刷新</button></section>'
  }

  function buildDirectoryActions(task) {
    if (!task?.workspaceRoot) return ''
    const items = [{label: '任务根目录', path: task.workspaceRoot}].concat(task.directories || [])
    return '<section class="panel build-directories"><div class="panel-head"><div><h2>编译目录</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">可复制路径或 cd 命令后在 SSH 终端中操作</p></div></div><div class="panel-body"><div class="build-directory-list">' + items.map(item => '<div class="build-directory-row"><span>' + escapeHtml(item.label) + '</span><code>' + escapeHtml(item.path) + '</code><button class="button small ghost" data-copy-build-path="' + escapeHtml(item.path) + '">复制路径</button><button class="button small ghost" data-copy-build-cd="' + escapeHtml(item.path) + '">复制 cd 命令</button></div>').join('') + '</div></div></section>'
  }

  function taskPresentation(status) {
    return {
      PENDING: ['等待中', 'brand'], RUNNING: ['执行中', 'brand'],
      SUCCEEDED: ['成功', 'green'], FAILED: ['失败', 'red']
    }[status] || [status || '未知', '']
  }

  function visibleBuildLogs() {
    const query = buildRuntime.logQuery.trim().toLocaleLowerCase()
    if (!query) return buildRuntime.logs
    return buildRuntime.logs.filter(item => (item.time + ' ' + item.message).toLocaleLowerCase().includes(query))
  }

  function buildHistoryContent() {
    const rows = buildRuntime.history.map(task => {
      const status = taskPresentation(task.status)
      const created = task.createdAt ? new Date(task.createdAt).toLocaleString('zh-CN') : '—'
      const running = task.status === 'RUNNING' || task.status === 'PENDING'
      return '<div class="build-history-row"><strong class="mono" title="' + escapeHtml(task.id) + '">' + escapeHtml(task.id.slice(0, 8)) + '</strong><span>' + escapeHtml(task.module) + '</span><span>' + escapeHtml(task.mode === 'COMPARE' ? '双分支' : '单分支') + '</span><span>' + escapeHtml(task.environmentName) + '</span><span class="badge ' + status[1] + '">' + status[0] + '</span><span>' + escapeHtml(created) + '</span><div class="environment-actions"><button class="button small" data-view-build-task="' + escapeHtml(task.id) + '">查看</button><button class="button small ghost" data-copy-build-path="' + escapeHtml(task.workspaceRoot) + '">复制目录</button><button class="button small ghost" data-delete-build-task="' + escapeHtml(task.id) + '" ' + (running ? 'disabled' : '') + '>删除记录</button><button class="button small ghost danger" data-clean-build-task="' + escapeHtml(task.id) + '" ' + (running ? 'disabled' : '') + '>清理目录</button></div></div>'
    }).join('')
    return '<section class="panel"><div class="panel-head"><div><h2>历史构建任务</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">任务摘要持久化保存；清理目录会同时删除远端工作区和本条记录</p></div><button class="button small ghost" data-refresh-build-history>刷新</button></div>' + (rows ? '<div class="build-history-table"><div class="build-history-row head"><span>任务</span><span>模块</span><span>模式</span><span>环境</span><span>状态</span><span>创建时间</span><span>操作</span></div>' + rows + '</div>' : '<div class="panel-body"><p style="color:var(--muted)">暂无历史构建任务。</p></div>') + '</section>'
  }

  function buildExecutionResult() {
    const task = buildRuntime.task
    if (!task) {
      return '<div class="summary-stack"><section class="panel"><div class="panel-head"><div><h2>执行状态</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">选择分支后开始构建</p></div><span class="badge">未开始</span></div><div class="panel-body"><div class="progress"><span style="width:0"></span></div></div></section><section class="panel"><div class="panel-head"><h2>实时日志</h2></div><div class="panel-body"><div class="terminal">构建开始后将在这里显示远端输出</div></div></section></div>'
    }
    const presentation = taskPresentation(task.status)
    const visibleLogs = visibleBuildLogs()
    const lines = visibleLogs.length
      ? visibleLogs.slice(-500).map(item => '<div><b>' + escapeHtml(item.time) + '</b> ' + escapeHtml(item.message) + '</div>').join('')
      : '<div>' + (buildRuntime.logQuery ? '没有匹配的日志' : '等待远端输出…') + '</div>'
    const logCount = buildRuntime.logQuery ? visibleLogs.length + ' / ' + buildRuntime.logs.length : buildRuntime.logs.length
    return '<div class="summary-stack"><section class="panel"><div class="panel-head"><div><h2>执行状态</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">' + escapeHtml(buildRuntime.latestMessage) + '</p></div><span class="badge ' + presentation[1] + '">' + presentation[0] + ' ' + task.progress + '%</span></div><div class="panel-body"><div class="progress"><span style="width:' + task.progress + '%"></span></div></div></section>' + buildDirectoryActions(task) + '<section class="panel"><div class="panel-head"><h2>实时日志</h2><span class="mono" style="color:var(--muted);font-size:12px">' + escapeHtml(task.id) + '</span></div><div class="panel-body"><div class="build-log-toolbar"><input id="build-log-search" value="' + escapeHtml(buildRuntime.logQuery) + '" placeholder="搜索日志关键字"><span>' + logCount + ' 条</span><button class="button small ghost" data-copy-build-logs>复制' + (buildRuntime.logQuery ? '搜索结果' : '全部日志') + '</button></div><div id="build-log-terminal" class="terminal build-terminal">' + lines + '</div></div></section></div>'
  }

  buildContent = function () {
    const environment = environments.find(item => item.id === state.selectedBuildEnvironment) || environments.find(item => item.type === 'build')
    if (state.buildTab === 'history') return buildTabs() + buildHistoryContent()
    if (!environment) {
      return buildTabs() + '<section class="panel"><div class="panel-body"><h2>尚未配置构建环境</h2><p style="margin-top:6px;color:var(--muted)">请先到资源中心新增构建环境，再返回创建构建任务。</p><button class="button primary" style="margin-top:14px" data-page="resources">打开资源中心</button></div></section>'
    }
    if (!environments.some(item => item.id === state.selectedBuildEnvironment)) state.selectedBuildEnvironment = environment.id
    const body = state.buildTab === 'single' ? singleBuildForm() : state.buildTab === 'compare' ? compareBuildForm() : buildConfig()
    if (state.buildTab === 'config') return environmentBar() + buildStorageSummary() + buildTabs() + body
    return environmentBar() + buildStorageSummary() + buildTabs() + (state.buildTab === 'single'
      ? '<div class="build-layout">' + body + buildExecutionResult() + '</div>'
      : body + '<div style="margin-top:16px">' + buildExecutionResult() + '</div>')
  }

  async function loadBuildConfiguration() {
    try {
      buildRuntime.configuration = await request('/api/build-configuration')
      render(false)
    } catch (error) {
      buildRuntime.configuration = null
      showToast((error.message || '构建配置加载失败') + '，请确认后端已启动')
    }
  }

  async function loadBuildHistory() {
    try {
      buildRuntime.history = await request('/api/build-tasks')
      render(false)
    } catch (error) {
      buildRuntime.history = []
      showToast(error.message || '历史构建任务加载失败')
    }
  }

  async function loadBuildStorage(force = false) {
    const environment = environments.find(item => item.id === state.selectedBuildEnvironment) || environments.find(item => item.type === 'build')
    if (!environment?._apiId) return
    if (!force && buildRuntime.storageEnvironmentId === environment._apiId && buildRuntime.storage) return
    buildRuntime.storageLoading = true
    buildRuntime.storageEnvironmentId = environment._apiId
    render(false)
    try {
      buildRuntime.storage = await request('/api/build-environments/' + environment._apiId + '/storage')
    } catch (error) {
      buildRuntime.storage = null
      showToast(error.message || '构建工作目录存储占用读取失败')
    } finally {
      buildRuntime.storageLoading = false
      render(false)
    }
  }

  async function viewBuildTask(id) {
    try {
      const task = await request('/api/build-tasks/' + id)
      buildRuntime.task = task
      buildRuntime.sequences = new Set((task.events || []).map(item => item.sequence))
      buildRuntime.logs = (task.events || []).filter(item => item.type === 'LOG').map(item => ({
        time: new Date(item.occurredAt).toLocaleTimeString('zh-CN', {hour12: false}), message: item.message
      }))
      buildRuntime.latestMessage = task.error || (task.status === 'SUCCEEDED' ? '构建任务执行成功' : '历史任务详情')
      state.buildTab = task.mode === 'COMPARE' ? 'compare' : 'single'
      localStorage.setItem('container-ops-kit.active-build-task', task.id)
      render()
    } catch (error) {
      showToast(error.message || '任务详情加载失败')
    }
  }

  async function deleteBuildTask(id, deleteWorkspace) {
    const copy = deleteWorkspace
      ? '确定清理该任务的远端工作目录并删除历史记录吗？此操作无法恢复。'
      : '确定只删除该任务的历史记录吗？远端工作目录将保留。'
    if (!confirm(copy)) return
    try {
      await request('/api/build-tasks/' + id + '?deleteWorkspace=' + deleteWorkspace, {method: 'DELETE'})
      if (buildRuntime.task?.id === id) {
        buildRuntime.task = null
        buildRuntime.logs = []
        localStorage.removeItem('container-ops-kit.active-build-task')
      }
      await loadBuildHistory()
      showToast(deleteWorkspace ? '远端目录和历史记录已清理' : '历史记录已删除')
    } catch (error) {
      showToast(error.message || '历史任务删除失败')
    }
  }

  async function restoreActiveBuildTask() {
    const id = localStorage.getItem('container-ops-kit.active-build-task')
    if (!id) return
    try {
      const task = await request('/api/build-tasks/' + id)
      buildRuntime.task = task
      buildRuntime.sequences = new Set((task.events || []).map(item => item.sequence))
      buildRuntime.logs = (task.events || []).filter(item => item.type === 'LOG').map(item => ({
        time: new Date(item.occurredAt).toLocaleTimeString('zh-CN', {hour12: false}), message: item.message
      }))
      buildRuntime.latestMessage = task.error || (task.status === 'SUCCEEDED' ? '构建任务执行成功' : '正在恢复实时日志')
      state.page = 'build'
      state.buildTab = task.mode === 'COMPARE' ? 'compare' : 'single'
      render(false)
      if (task.status === 'RUNNING' || task.status === 'PENDING') subscribeBuildTask(task.id)
    } catch {
      localStorage.removeItem('container-ops-kit.active-build-task')
    }
  }

  function branchPayload(values, prefix) {
    return {
      cbbWebDevBranch: values[prefix + 'CbbWebDevBranch'],
      archDesignBranch: values[prefix + 'ArchDesignBranch']
    }
  }

  createBuildTask = async function (mode = 'single') {
    const environment = environments.find(item => item.id === state.selectedBuildEnvironment) || environments.find(item => item.type === 'build')
    const form = document.querySelector(mode === 'compare' ? '#compare-build-form' : '#single-build-form')
    if (!environment?._apiId || !form || !form.reportValidity() || buildRuntime.starting) {
      if (!environment?._apiId) showToast('请先配置构建环境')
      return
    }
    const values = Object.fromEntries(new FormData(form))
    const body = mode === 'compare'
      ? {mode: 'COMPARE', environmentId: environment._apiId, module: values.module, baseline: branchPayload(values, 'baseline'), candidate: branchPayload(values, 'candidate')}
      : {mode: 'SINGLE', environmentId: environment._apiId, module: values.module, baseline: {cbbWebDevBranch: values.cbbWebDevBranch, archDesignBranch: values.archDesignBranch}, candidate: null}
    buildRuntime.starting = true
    buildRuntime.logs = []
    buildRuntime.sequences.clear()
    buildRuntime.latestMessage = '正在创建构建任务'
    buildRuntime.eventSource?.close()
    render(false)
    try {
      buildRuntime.task = await request('/api/build-tasks', {method: 'POST', body: JSON.stringify(body)})
      localStorage.setItem('container-ops-kit.active-build-task', buildRuntime.task.id)
      tasks.unshift({_apiId: buildRuntime.task.id, id: 'build-' + buildRuntime.task.id.slice(0, 8), kind: 'build', input: mode === 'compare' ? '双分支对比构建' : '单分支构建', environment: environment.name, status: 'running', statusLabel: '执行中', updated: '刚刚'})
      subscribeBuildTask(buildRuntime.task.id)
      loadBuildHistory()
      showToast('构建任务已开始')
    } catch (error) {
      buildRuntime.latestMessage = error.message || '构建任务创建失败'
      showToast(buildRuntime.latestMessage)
    } finally {
      buildRuntime.starting = false
      render(false)
    }
  }

  function subscribeBuildTask(taskId) {
    const source = new EventSource('/api/build-tasks/' + taskId + '/events')
    buildRuntime.eventSource = source
    source.onmessage = event => {
      const item = JSON.parse(event.data)
      if (buildRuntime.sequences.has(item.sequence)) return
      buildRuntime.sequences.add(item.sequence)
      buildRuntime.latestMessage = item.message
      buildRuntime.task.progress = item.progress
      buildRuntime.task.status = item.taskStatus
      if (item.type === 'LOG') {
        buildRuntime.logs.push({time: new Date(item.occurredAt).toLocaleTimeString('zh-CN', {hour12: false}), message: item.message})
      }
      updateDashboardBuildTask(taskId, item.taskStatus)
      render(false)
      if (item.taskStatus === 'SUCCEEDED' || item.taskStatus === 'FAILED') {
        source.close()
        request('/api/build-tasks/' + taskId).then(task => {
          buildRuntime.task = task
          loadBuildHistory()
          render(false)
          showToast(task.status === 'SUCCEEDED' ? '构建成功' : task.error || '构建失败')
        }).catch(() => {})
      }
    }
    source.onerror = () => {
      if (buildRuntime.task?.status === 'RUNNING' || buildRuntime.task?.status === 'PENDING') {
        buildRuntime.latestMessage = '实时日志连接中断，正在重连'
        render(false)
      }
    }
  }

  function updateDashboardBuildTask(taskId, status) {
    const task = tasks.find(item => item._apiId === taskId)
    if (!task) return
    task.status = status === 'SUCCEEDED' ? 'success' : status === 'FAILED' ? 'failed' : 'running'
    task.statusLabel = status === 'SUCCEEDED' ? '成功' : status === 'FAILED' ? '失败' : '执行中'
    task.updated = '刚刚'
  }

  const deploymentRuntime = {
    artifacts: [],
    artifactId: '',
    candidates: null,
    preparation: null,
    activeService: '',
    logs: [],
    eventSource: null,
    busy: false
  }

  const stagePresentation = {
    ANALYZED: ['已分析', 'brand'],
    GENERATED: ['已生成', 'violet'],
    RENDERED: ['渲染通过', 'green'],
    DEPLOYING: ['部署中', 'brand'],
    SUCCEEDED: ['成功', 'green'],
    FAILED: ['失败', 'red']
  }

  function deploymentServiceRows(preparation) {
    if (!preparation) return ''
    return Object.entries(preparation.services).map(([name, service]) => {
      const presentation = service ? stagePresentation[service.stage] || ['处理中', 'brand'] : ['分析中', 'brand']
      const errors = service ? [...(service.errors || []), service.stageError].filter(Boolean).join('；') : '正在从构建机和 OM 采集数据'
      return '<button type="button" class="deployment-service-row ' + (deploymentRuntime.activeService === name ? 'active' : '') + '" data-deployment-service="' + escapeHtml(name) + '"><span><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(errors || ((service?.replaceItems?.length || 0) + ' 项自动替换')) + '</small></span><span class="badge ' + presentation[1] + '">' + presentation[0] + '</span></button>'
    }).join('')
  }

  function deploymentDetails() {
    const preparation = deploymentRuntime.preparation
    const service = preparation?.services?.[deploymentRuntime.activeService]
    if (!service) return '<section class="panel"><div class="panel-body"><div class="environment-empty">分析完成后可查看替换项并编辑 values.yaml。</div></div></section>'
    const replaces = (service.replaceItems || []).map(item => '<div class="replacement-row"><span>' + escapeHtml(item.location) + '</span><strong class="mono">' + escapeHtml(item.key) + '</strong><del>' + escapeHtml(item.oldValue) + '</del><ins>' + escapeHtml(item.newValue) + '</ins></div>').join('') || '<div class="environment-empty">没有自动替换项</div>'
    return '<div class="summary-stack"><section class="panel"><div class="panel-head"><div><h2>替换预览</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">未解析镜像：' + escapeHtml((service.unresolvedImages || []).join('、') || '无') + '</p></div><span class="badge">' + (service.replaceItems || []).length + ' 项</span></div><div class="panel-body"><div class="replacement-list">' + replaces + '</div></div></section><section class="panel"><div class="panel-head"><h2>values.yaml</h2><button class="button small" data-deployment-save-values>保存修改</button></div><div class="panel-body"><textarea id="deployment-values" class="deployment-values mono">' + escapeHtml(service.values || '') + '</textarea></div></section></div>'
  }

  function deploymentContent() {
    const environment = environments.find(item => item.id === state.selectedContainerEnvironment) || environments.find(item => item.type === 'container')
    if (!environment) return pageTitle('部署', '选择成功产物和容器环境，完成校验后部署。') + '<section class="panel empty"><div><h2>尚未配置容器环境</h2><button class="button primary" style="margin-top:18px" data-page="resources">打开资源中心</button></div></section>'
    if (!environments.some(item => item.id === state.selectedContainerEnvironment)) state.selectedContainerEnvironment = environment.id
    const artifactOptions = deploymentRuntime.artifacts.map(item => '<option value="' + item.id + '" ' + (String(item.id) === String(deploymentRuntime.artifactId) ? 'selected' : '') + '>' + escapeHtml(item.module) + ' · ' + escapeHtml(item.archDesignBranch) + ' · ' + new Date(item.createdAt).toLocaleString('zh-CN') + '</option>').join('')
    const candidate = deploymentRuntime.candidates
    const preparation = deploymentRuntime.preparation
    const preparedServices = preparation ? Object.values(preparation.services) : []
    const canApply = preparedServices.length > 0 && preparedServices.every(item => item?.stage === 'ANALYZED')
    const canRender = preparedServices.length > 0 && preparedServices.every(item => item?.stage === 'GENERATED')
    const canDeploy = preparedServices.length > 0 && preparedServices.every(item => item?.stage === 'RENDERED')
    const serviceOptions = candidate ? candidate.services.map(item => '<label class="deployment-check"><input type="checkbox" name="deploymentService" value="' + escapeHtml(item) + '" checked><span>' + escapeHtml(item) + '</span></label>').join('') : ''
    const namespaces = candidate ? candidate.namespaces.map(item => '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + '</option>').join('') : ''
    const logs = deploymentRuntime.logs.length ? deploymentRuntime.logs.slice(-500).map(item => '<div><b>' + escapeHtml(item.time) + '</b> [' + escapeHtml(item.stage) + '] ' + escapeHtml((item.service ? item.service + ' · ' : '') + item.message) + '</div>').join('') : '<div>部署阶段日志将在这里显示</div>'
    return pageTitle('部署', '从成功构建产物生成 Chart，校验后执行覆盖式重装。') + containerEnvironmentBar()
      + '<section class="panel"><div class="panel-head"><div><h2>部署输入</h2><p style="color:var(--muted);margin-top:3px;font-size:12px">OM 固定使用 root，命令不加 sudo</p></div><span class="badge red">uninstall → install</span></div><div class="panel-body"><div class="form-grid"><div class="field wide"><label>成功构建产物</label><select id="deployment-artifact" ' + (deploymentRuntime.busy ? 'disabled' : '') + '><option value="">请选择</option>' + artifactOptions + '</select></div><div class="field"><label>模块</label><input readonly value="' + escapeHtml(candidate?.module || deploymentRuntime.artifacts.find(item => String(item.id) === String(deploymentRuntime.artifactId))?.module || '—') + '"></div><div class="field"><label>命名空间</label><select id="deployment-namespace" ' + (!candidate ? 'disabled' : '') + '>' + namespaces + '</select></div></div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="button" data-deployment-candidates ' + (!deploymentRuntime.artifactId || deploymentRuntime.busy ? 'disabled' : '') + '>读取服务与命名空间</button></div>'
      + (candidate ? '<div class="deployment-service-checks">' + serviceOptions + '</div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="button primary" data-create-deploy-task ' + (deploymentRuntime.busy ? 'disabled' : '') + '>① 分析补全</button></div>' : '') + '</div></section>'
      + (preparation ? '<div class="deployment-layout"><section class="panel"><div class="panel-head"><h2>服务与阶段</h2><span class="badge">revision ' + preparation.revision + '</span></div><div class="panel-body"><div class="deployment-service-list">' + deploymentServiceRows(preparation) + '</div><div class="deployment-actions"><button class="button" data-deployment-action="apply" ' + (!canApply || deploymentRuntime.busy ? 'disabled' : '') + '>② 生成 Chart</button><button class="button" data-deployment-action="render" ' + (!canRender || deploymentRuntime.busy ? 'disabled' : '') + '>③ 渲染校验</button><button class="button primary" data-deployment-action="deploy" ' + (!canDeploy || deploymentRuntime.busy ? 'disabled' : '') + '>④ 确认并部署</button></div></div></section>' + deploymentDetails() + '</div><section class="panel" style="margin-top:16px"><div class="panel-head"><h2>实时日志</h2><span class="mono" style="color:var(--muted);font-size:12px">' + escapeHtml(preparation.id) + '</span></div><div class="panel-body"><div class="terminal build-terminal">' + logs + '</div></div></section>' : '')
  }

  const originalCommonPage = commonPage
  commonPage = function (page) {
    return page === 'deploy' ? deploymentContent() : originalCommonPage(page)
  }

  async function loadDeploymentArtifacts() {
    try {
      deploymentRuntime.artifacts = await request('/api/build-artifacts')
      if (!deploymentRuntime.artifactId && deploymentRuntime.artifacts.length) deploymentRuntime.artifactId = String(deploymentRuntime.artifacts[0].id)
      render(false)
    } catch (error) {
      showToast(error.message || '构建产物加载失败')
    }
  }

  async function loadDeploymentCandidates() {
    const environment = environments.find(item => item.id === state.selectedContainerEnvironment) || environments.find(item => item.type === 'container')
    if (!deploymentRuntime.artifactId || !environment?._apiId) return showToast('请选择构建产物和容器环境')
    deploymentRuntime.busy = true
    render(false)
    try {
      deploymentRuntime.candidates = await request('/api/deployment-candidates?artifactId=' + encodeURIComponent(deploymentRuntime.artifactId) + '&environmentId=' + encodeURIComponent(environment._apiId))
    } catch (error) {
      showToast(error.message || '候选数据读取失败')
    } finally {
      deploymentRuntime.busy = false
      render(false)
    }
  }

  createDeployTask = async function () {
    const environment = environments.find(item => item.id === state.selectedContainerEnvironment) || environments.find(item => item.type === 'container')
    const services = [...document.querySelectorAll('[name="deploymentService"]:checked')].map(item => item.value)
    const namespace = document.querySelector('#deployment-namespace')?.value
    if (!services.length || !namespace || !environment?._apiId) return showToast('请选择命名空间和至少一个服务')
    deploymentRuntime.busy = true
    render(false)
    try {
      deploymentRuntime.preparation = await request('/api/deployment-preparations', {method: 'POST', body: JSON.stringify({artifactId: Number(deploymentRuntime.artifactId), environmentId: environment._apiId, namespace, services})})
      deploymentRuntime.activeService = services[0]
      deploymentRuntime.logs = []
      subscribeDeployment(deploymentRuntime.preparation.id)
    } catch (error) {
      showToast(error.message || '部署分析启动失败')
    } finally {
      deploymentRuntime.busy = false
      render(false)
    }
  }

  function subscribeDeployment(id) {
    deploymentRuntime.eventSource?.close()
    const source = new EventSource('/api/deployment-preparations/' + id + '/events')
    deploymentRuntime.eventSource = source
    source.onmessage = event => {
      const item = JSON.parse(event.data)
      deploymentRuntime.logs.push({time: new Date(item.occurredAt).toLocaleTimeString('zh-CN', {hour12: false}), ...item})
      request('/api/deployment-preparations/' + id).then(value => {
        deploymentRuntime.preparation = value
        render(false)
      }).catch(() => {})
    }
  }

  async function deploymentAction(action) {
    const preparation = deploymentRuntime.preparation
    if (!preparation || deploymentRuntime.busy) return
    if (action === 'deploy') {
      const services = Object.keys(preparation.services).join('、')
      if (!confirm('即将部署：' + services + '\n\n将依次执行渲染、卸载旧 release、删除冲突资源、重新安装并等待就绪。确定继续吗？')) return
    }
    deploymentRuntime.busy = true
    render(false)
    try {
      if (action === 'deploy') {
        const confirmation = await request('/api/deployment-preparations/' + preparation.id + '/confirmation', {method: 'POST'})
        await request('/api/deployment-preparations/' + preparation.id + '/deploy', {method: 'POST', body: JSON.stringify(confirmation)})
        showToast('部署任务已开始，服务将串行执行')
      } else {
        deploymentRuntime.preparation = await request('/api/deployment-preparations/' + preparation.id + '/' + action, {method: 'POST'})
      }
    } catch (error) {
      showToast(error.message || '阶段执行失败')
    } finally {
      deploymentRuntime.busy = false
      render(false)
    }
  }

  async function saveDeploymentValues() {
    const preparation = deploymentRuntime.preparation
    const service = deploymentRuntime.activeService
    const values = document.querySelector('#deployment-values')?.value
    if (!preparation || !service || values == null) return
    try {
      await request('/api/deployment-preparations/' + preparation.id + '/services/' + encodeURIComponent(service) + '/values', {method: 'PUT', body: JSON.stringify({values})})
      deploymentRuntime.preparation = await request('/api/deployment-preparations/' + preparation.id)
      render(false)
      showToast('values.yaml 已保存，请重新生成和渲染')
    } catch (error) {
      showToast(error.message || 'values.yaml 保存失败')
    }
  }

  document.addEventListener('change', function (event) {
    if (event.target.id === 'deployment-artifact') {
      deploymentRuntime.artifactId = event.target.value
      deploymentRuntime.candidates = null
      deploymentRuntime.preparation = null
      render(false)
    }
    if (event.target.id === 'container-environment-selector') {
      deploymentRuntime.candidates = null
      deploymentRuntime.preparation = null
      deploymentRuntime.eventSource?.close()
      render(false)
    }
  })

  document.addEventListener('input', function (event) {
    if (event.target.id !== 'build-log-search') return
    const cursor = event.target.selectionStart
    buildRuntime.logQuery = event.target.value
    render(false)
    const search = document.querySelector('#build-log-search')
    search?.focus()
    search?.setSelectionRange(cursor, cursor)
  })

  document.addEventListener('click', function (event) {
    if (event.target.closest?.('[data-deployment-candidates]')) return loadDeploymentCandidates()
    const service = event.target.closest?.('[data-deployment-service]')
    if (service) {
      deploymentRuntime.activeService = service.dataset.deploymentService
      render(false)
      return
    }
    const action = event.target.closest?.('[data-deployment-action]')
    if (action) return deploymentAction(action.dataset.deploymentAction)
    if (event.target.closest?.('[data-deployment-save-values]')) return saveDeploymentValues()
  })

  document.addEventListener('click', function (event) {
    const testButton = event.target.closest?.('[data-drawer-test]')
    if (testButton) {
      event.preventDefault()
      event.stopImmediatePropagation()
      previewConnection()
      return
    }
    const copyButton = event.target.closest?.('[data-copy-credential]')
    if (!copyButton) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const environment = environments.find(item => item.id === copyButton.dataset.environmentId)
    const value = environment?.[copyButton.dataset.copyCredential]
    if (!value) {
      showToast('该凭据尚未配置')
      return
    }
    copyText(value, '已复制')
  }, true)

  document.addEventListener('change', function (event) {
    if (event.target.id === 'build-environment-selector') {
      buildRuntime.storage = null
      buildRuntime.storageEnvironmentId = null
      loadBuildStorage(true)
    }
  })

  document.addEventListener('click', function (event) {
    const buildPage = event.target.closest?.('[data-page="build"]')
    if (buildPage) setTimeout(() => loadBuildStorage(), 0)
    const pathButton = event.target.closest?.('[data-copy-build-path]')
    if (pathButton) return copyText(pathButton.dataset.copyBuildPath, '编译目录已复制')
    const cdButton = event.target.closest?.('[data-copy-build-cd]')
    if (cdButton) return copyText("cd '" + cdButton.dataset.copyBuildCd.replace(/'/g, "'\\''") + "'", 'cd 命令已复制')
    const viewButton = event.target.closest?.('[data-view-build-task]')
    if (viewButton) return viewBuildTask(viewButton.dataset.viewBuildTask)
    const deleteButton = event.target.closest?.('[data-delete-build-task]')
    if (deleteButton) return deleteBuildTask(deleteButton.dataset.deleteBuildTask, false)
    const cleanButton = event.target.closest?.('[data-clean-build-task]')
    if (cleanButton) return deleteBuildTask(cleanButton.dataset.cleanBuildTask, true)
    if (event.target.closest?.('[data-refresh-build-history]')) return loadBuildHistory()
    if (event.target.closest?.('[data-refresh-build-storage]')) return loadBuildStorage(true)
    if (event.target.closest?.('[data-copy-build-logs]')) {
      const logs = visibleBuildLogs()
      if (!logs.length) return showToast('没有可复制的日志')
      return copyText(logs.map(item => item.time + ' ' + item.message).join('\n'), '日志已复制')
    }
    const tab = event.target.closest?.('[data-build-tab="history"]')
    if (tab) return loadBuildHistory()
  })

  const style = document.createElement('style')
  style.textContent = '.environment-row.container-row{grid-template-columns:minmax(190px,1.2fr) minmax(150px,.9fr) minmax(170px,1fr) minmax(170px,1fr) 78px 96px minmax(130px,.8fr) minmax(290px,1.4fr);min-width:1380px}.service-address{display:block;color:var(--brand);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.service-address:hover{text-decoration:underline}.service-cell{min-width:0}.credential-line{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;color:var(--muted);font-size:12px}.credential-line span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.credential-line button{border:0;padding:0;color:var(--brand);background:transparent;font-size:11px}.environment-filter.compact{max-width:100px;padding:5px 7px}.build-terminal{max-height:420px;overflow:auto}.build-terminal div{min-height:20px}.build-log-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px}.build-log-toolbar input{min-width:180px;max-width:320px;padding:7px 9px;border:1px solid var(--line);border-radius:7px}.build-log-toolbar span{color:var(--muted);font-size:12px}.build-log-toolbar .button{margin-left:auto}.field input[readonly]{color:var(--muted);cursor:default}.build-storage{display:flex;align-items:center;gap:14px;margin:-8px 0 16px;padding:10px 14px;border:1px solid var(--line);border-radius:9px;background:var(--surface-soft);font-size:12px}.build-storage>span{color:var(--muted)}.build-storage .button{margin-left:auto}.build-directory-list{display:grid;gap:8px}.build-directory-row{display:grid;grid-template-columns:130px minmax(220px,1fr) auto auto;align-items:center;gap:8px}.build-directory-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.build-history-table{overflow-x:auto}.build-history-row{display:grid;grid-template-columns:90px 120px 80px minmax(130px,1fr) 80px 170px minmax(350px,1.4fr);gap:12px;align-items:center;min-width:1060px;min-height:52px;padding:0 16px;border-bottom:1px solid var(--line);font-size:12px}.build-history-row.head{min-height:36px;color:var(--faint);background:var(--surface-soft)}.button.danger{color:var(--red)}.deployment-service-checks{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.deployment-check{display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--line);border-radius:8px}.deployment-layout{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;margin-top:16px;align-items:start}.deployment-service-list{display:grid;gap:7px}.deployment-service-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);text-align:left}.deployment-service-row.active{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}.deployment-service-row span:first-child{display:grid;gap:3px;min-width:0}.deployment-service-row small{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.deployment-actions{display:grid;gap:8px;margin-top:14px}.replacement-list{display:grid;gap:7px;max-height:250px;overflow:auto}.replacement-row{display:grid;grid-template-columns:90px minmax(120px,.8fr) minmax(120px,1fr) minmax(120px,1fr);gap:8px;padding:8px;border-bottom:1px solid var(--line);font-size:12px}.replacement-row del{color:var(--red)}.replacement-row ins{color:var(--green);text-decoration:none}.deployment-values{width:100%;min-height:380px;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:12px;background:#1d2b34;color:#c2ccd2;font-size:12px;line-height:1.6}@media(max-width:1000px){.deployment-layout{grid-template-columns:1fr}.build-directory-row{grid-template-columns:1fr auto auto}.build-directory-row span{grid-column:1/-1}}@media(max-width:700px){.environment-row.container-row{min-width:0;grid-template-columns:repeat(2,minmax(0,1fr))}.environment-row.container-row>[data-label]::before{content:attr(data-label);display:block;margin-bottom:4px;color:var(--faint);font-size:12px}.environment-row.container-row>.environment-actions{grid-column:1/-1}.replacement-row{grid-template-columns:1fr}.build-storage{align-items:flex-start;flex-wrap:wrap}.build-storage .button{margin-left:0}.build-directory-row{grid-template-columns:1fr}.build-directory-row span{grid-column:auto}.build-log-toolbar{align-items:stretch;flex-direction:column}.build-log-toolbar input{max-width:none}.build-log-toolbar .button{margin-left:0}}'
  document.head.appendChild(style)

  new MutationObserver(patchEnvironmentForm).observe(document.querySelector('#app'), {childList: true, subtree: true})
  render(false)
  loadResources()
  loadBuildConfiguration()
  loadBuildHistory()
  loadDeploymentArtifacts()
  restoreActiveBuildTask()
})()
