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

  const style = document.createElement('style')
  style.textContent = '.environment-row.container-row{grid-template-columns:minmax(190px,1.2fr) minmax(150px,.9fr) minmax(170px,1fr) minmax(170px,1fr) 78px 96px minmax(130px,.8fr) minmax(290px,1.4fr);min-width:1380px}.service-address{display:block;color:var(--brand);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.service-address:hover{text-decoration:underline}.service-cell{min-width:0}.credential-line{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;color:var(--muted);font-size:12px}.credential-line span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.credential-line button{border:0;padding:0;color:var(--brand);background:transparent;font-size:11px}.environment-filter.compact{max-width:100px;padding:5px 7px}@media(max-width:700px){.environment-row.container-row{min-width:0;grid-template-columns:repeat(2,minmax(0,1fr))}.environment-row.container-row>[data-label]::before{content:attr(data-label);display:block;margin-bottom:4px;color:var(--faint);font-size:12px}.environment-row.container-row>.environment-actions{grid-column:1/-1}}'
  document.head.appendChild(style)

  new MutationObserver(patchEnvironmentForm).observe(document.querySelector('#app'), {childList: true, subtree: true})
  render(false)
  loadResources()
})()
