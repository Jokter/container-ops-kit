(function () {
  const runtime = {
    environmentId: '', namespace: 'mae', services: [], groups: [], resources: [], types: [],
    serviceKey: '', resource: null, editable: null, yaml: '', preview: null, tab: 'yaml',
    serviceQuery: '', resourceQuery: '', loading: false, busy: false, createOpen: false,
    createTypeKey: '', createYaml: '', createPreview: null, error: ''
  }

  const groupKeys = {SHARED: 'group:shared', UNASSIGNED: 'group:unassigned', CLUSTER: 'group:cluster'}
  const categoryNames = {WORKLOAD: '工作负载', CONFIGURATION: '配置', NETWORK: '网络', CUSTOM: '自定义资源', OTHER: '其它资源'}
  const sourceNames = {HELM_RELEASE: 'Helm Release', WORKLOAD: '工作负载', LABEL: '标签识别'}

  async function api(url, options) {
    const response = await fetch(url, Object.assign({headers: {'Content-Type': 'application/json'}}, options || {}))
    if (!response.ok) {
      const body = await response.json().catch(() => ({message: '请求失败'}))
      throw new Error(body.message || '请求失败')
    }
    return response.json()
  }

  function query(values) {
    return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString()
  }

  function containerEnvironments() {
    return environments.filter(item => item.type === 'container' && item._apiId != null)
  }

  function selectedServiceName() {
    return runtime.services.find(item => item.key === runtime.serviceKey)?.name
      || runtime.groups.find(item => groupKeys[item.type] === runtime.serviceKey)?.name
      || '资源'
  }

  function message(error) {
    runtime.error = error instanceof Error ? error.message : '操作失败'
    showToast(runtime.error)
  }

  async function loadWorkspace(refresh = false) {
    const available = containerEnvironments()
    if (!runtime.environmentId) runtime.environmentId = available.find(item => item.id === state.selectedContainerEnvironment)?._apiId || available[0]?._apiId || ''
    if (!runtime.environmentId || !runtime.namespace.trim() || runtime.loading) return
    runtime.loading = true
    runtime.error = ''
    render(false)
    try {
      const result = await api('/api/container-resource-services?' + query({environmentId: runtime.environmentId, namespace: runtime.namespace.trim(), refresh}))
      runtime.services = result.services
      runtime.groups = result.groups
      const keys = new Set([...runtime.services.map(item => item.key), ...runtime.groups.map(item => groupKeys[item.type])])
      if (!keys.has(runtime.serviceKey)) runtime.serviceKey = runtime.services[0]?.key || groupKeys[runtime.groups[0]?.type] || ''
      await loadResources(false)
      if (refresh) showToast('环境资源已重新发现')
    } catch (error) {
      message(error)
    } finally {
      runtime.loading = false
      render(false)
    }
  }

  async function loadResources(shouldRender = true) {
    if (!runtime.environmentId || !runtime.serviceKey) return
    runtime.busy = true
    if (shouldRender) render(false)
    try {
      const result = await api('/api/container-service-resources?' + query({environmentId: runtime.environmentId, namespace: runtime.namespace.trim(), serviceKey: runtime.serviceKey}))
      runtime.resources = result.resources
      runtime.resource = runtime.resources[0] || null
      if (runtime.resource) await readResource(false)
      else clearEditor()
    } catch (error) {
      clearEditor()
      message(error)
    } finally {
      runtime.busy = false
      if (shouldRender) render(false)
    }
  }

  async function readResource(shouldRender = true) {
    if (!runtime.resource) return
    runtime.busy = true
    runtime.preview = null
    runtime.tab = 'yaml'
    if (shouldRender) render(false)
    try {
      const coordinates = {
        environmentId: runtime.environmentId, namespace: runtime.namespace.trim(), group: runtime.resource.group,
        version: runtime.resource.version, resource: runtime.resource.resource, name: runtime.resource.name
      }
      runtime.editable = await api('/api/container-resources?' + query(coordinates))
      runtime.yaml = runtime.editable.yaml
    } catch (error) {
      clearEditor()
      message(error)
    } finally {
      runtime.busy = false
      if (shouldRender) render(false)
    }
  }

  function clearEditor() {
    runtime.resource = null
    runtime.editable = null
    runtime.yaml = ''
    runtime.preview = null
  }

  function renderSearch(id, cursor) {
    render(false)
    const field = document.querySelector('#' + id)
    field?.focus()
    field?.setSelectionRange(cursor, cursor)
  }

  function updateBody() {
    return {
      environmentId: Number(runtime.environmentId), coordinates: runtime.editable.coordinates,
      yaml: runtime.yaml, expectedResourceVersion: runtime.editable.resourceVersion
    }
  }

  async function previewUpdate() {
    if (!runtime.editable || runtime.busy) return
    runtime.yaml = document.querySelector('#resource-yaml-editor')?.value || runtime.yaml
    runtime.busy = true
    render(false)
    try {
      runtime.preview = await api('/api/container-resource-changes/preview', {method: 'POST', body: JSON.stringify(updateBody())})
      runtime.tab = 'diff'
    } catch (error) {
      message(error)
    } finally {
      runtime.busy = false
      render(false)
    }
  }

  async function applyUpdate() {
    if (!runtime.preview || runtime.busy || !confirm('将当前 YAML 同步到环境中的“' + runtime.editable.coordinates.name + '”，是否继续？')) return
    runtime.busy = true
    render(false)
    try {
      const result = await api('/api/container-resource-changes/apply', {method: 'POST', body: JSON.stringify(updateBody())})
      runtime.editable = Object.assign({}, runtime.editable, result)
      runtime.yaml = result.yaml
      runtime.preview = null
      runtime.tab = 'yaml'
      showToast('资源已同步到环境')
    } catch (error) {
      message(error)
    } finally {
      runtime.busy = false
      render(false)
    }
  }

  async function openCreate() {
    if (runtime.serviceKey.startsWith('group:') || runtime.busy) return
    runtime.createOpen = true
    runtime.createPreview = null
    render(false)
    try {
      if (!runtime.types.length) runtime.types = await api('/api/container-resource-types?' + query({environmentId: runtime.environmentId}))
      const initial = runtime.types.find(item => item.kind === 'ConfigMap') || runtime.types[0]
      runtime.createTypeKey = typeKey(initial)
      resetCreateYaml()
    } catch (error) {
      message(error)
    }
    render(false)
  }

  function typeKey(item) {
    return item ? item.group + '/' + item.version + '/' + item.resource : ''
  }

  function selectedCreateType() {
    return runtime.types.find(item => typeKey(item) === runtime.createTypeKey)
  }

  function resetCreateYaml() {
    const type = selectedCreateType()
    if (!type) return
    const apiVersion = type.group ? type.group + '/' + type.version : type.version
    const body = type.kind === 'ConfigMap' ? 'data: {}' : 'spec: {}'
    runtime.createYaml = 'apiVersion: ' + apiVersion + '\nkind: ' + type.kind + '\nmetadata:\n  name: ' + selectedServiceName() + '-extra\n' + body + '\n'
    runtime.createPreview = null
  }

  function createBody() {
    return {environmentId: Number(runtime.environmentId), namespace: runtime.namespace.trim(), serviceKey: runtime.serviceKey, yaml: runtime.createYaml}
  }

  async function previewCreate() {
    runtime.createYaml = document.querySelector('#create-resource-yaml')?.value || runtime.createYaml
    runtime.busy = true
    render(false)
    try {
      runtime.createPreview = await api('/api/container-resources/preview', {method: 'POST', body: JSON.stringify(createBody())})
    } catch (error) {
      message(error)
    } finally {
      runtime.busy = false
      render(false)
    }
  }

  async function createResource() {
    if (!runtime.createPreview || runtime.busy) return
    runtime.busy = true
    render(false)
    try {
      await api('/api/container-resources', {method: 'POST', body: JSON.stringify(createBody())})
      runtime.createOpen = false
      await loadWorkspace(false)
      showToast('资源已添加到环境')
    } catch (error) {
      message(error)
    } finally {
      runtime.busy = false
      render(false)
    }
  }

  function serviceRows() {
    const search = runtime.serviceQuery.toLowerCase()
    const services = runtime.services.filter(item => item.name.toLowerCase().includes(search)).map(item =>
      '<button data-resource-service="' + escapeHtml(item.key) + '" class="' + (runtime.serviceKey === item.key ? 'active' : '') + '"><strong>' + escapeHtml(item.name) + '</strong><span>' + (sourceNames[item.source] || item.source) + ' · ' + item.resourceCount + ' 个资源</span></button>'
    ).join('')
    const groups = runtime.groups.filter(item => item.name.includes(runtime.serviceQuery)).map(item =>
      '<button data-resource-service="' + groupKeys[item.type] + '" class="' + (runtime.serviceKey === groupKeys[item.type] ? 'active' : '') + '"><strong>' + escapeHtml(item.name) + '</strong><span>' + item.resourceCount + ' 个资源</span></button>'
    ).join('')
    return '<div class="cr-group-label">业务服务</div>' + services + '<div class="cr-group-label">其它范围</div>' + groups
  }

  function resourceRows() {
    const filtered = runtime.resources.filter(item => [item.name, item.kind, item.resource].some(value => value.toLowerCase().includes(runtime.resourceQuery.toLowerCase())))
    const categories = new Map()
    filtered.forEach(item => categories.set(item.category, [...(categories.get(item.category) || []), item]))
    if (!filtered.length) return '<div class="cr-empty">该范围没有资源</div>'
    return [...categories.entries()].map(([category, items]) => '<div class="cr-group-label">' + (categoryNames[category] || category) + ' · ' + items.length + '</div>' + items.map(item => {
      const key = [item.group, item.resource, item.name].join('/')
      const active = runtime.resource && [runtime.resource.group, runtime.resource.resource, runtime.resource.name].join('/') === key
      return '<button data-resource-item="' + escapeHtml(key) + '" class="' + (active ? 'active' : '') + '"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.kind) + ' · ' + escapeHtml(item.group || 'core') + '/' + escapeHtml(item.version) + '</span><em>' + escapeHtml(item.status) + '</em></button>'
    }).join('')).join('')
  }

  function editorContent() {
    if (!runtime.editable || !runtime.resource) return '<div class="cr-editor-empty">选择一个资源后查看和修改 YAML</div>'
    const warning = runtime.editable.managedByHelm ? '<div class="cr-warning">该资源由 Helm 管理，后续发布可能覆盖手工修改。</div>' : ''
    const tabs = '<div class="cr-tabs"><button data-resource-tab="yaml" class="' + (runtime.tab === 'yaml' ? 'active' : '') + '">YAML</button><button data-resource-tab="diff" class="' + (runtime.tab === 'diff' ? 'active' : '') + '" ' + (!runtime.preview ? 'disabled' : '') + '>变更 Diff</button><span>resourceVersion: ' + escapeHtml(runtime.editable.resourceVersion) + '</span></div>'
    const body = runtime.tab === 'yaml'
      ? '<textarea id="resource-yaml-editor" class="cr-yaml" spellcheck="false">' + escapeHtml(runtime.yaml) + '</textarea>'
      : '<div class="cr-diff"><pre>' + escapeHtml(runtime.preview?.diff || '没有变化') + '</pre>' + (runtime.preview?.warnings || []).map(item => '<span>' + escapeHtml(item) + '</span>').join('') + '<button class="button primary" data-apply-resource>确认同步到环境</button></div>'
    return '<div class="cr-editor-head"><div><h2>' + escapeHtml(runtime.editable.coordinates.name) + '</h2><p>' + escapeHtml(runtime.resource.kind) + ' · ' + escapeHtml(runtime.editable.coordinates.group || 'core') + '/' + escapeHtml(runtime.editable.coordinates.version) + '</p></div><div><button class="button" data-reread-resource>从环境重新读取</button><button class="button primary" data-preview-resource ' + (runtime.busy ? 'disabled' : '') + '>预览并同步</button></div></div>' + warning + tabs + body
  }

  function createDialog() {
    if (!runtime.createOpen) return ''
    const options = runtime.types.map(item => '<option value="' + escapeHtml(typeKey(item)) + '" ' + (runtime.createTypeKey === typeKey(item) ? 'selected' : '') + '>' + escapeHtml(item.kind + ' · ' + (item.group || 'core') + '/' + item.version) + '</option>').join('')
    return '<div class="cr-modal"><div class="cr-dialog"><div class="cr-dialog-head"><h2>新增服务资源</h2><button data-close-resource-create>×</button></div><div class="cr-create-context"><label><span>所属服务</span><strong>' + escapeHtml(selectedServiceName()) + '</strong></label><label><span>资源类型</span><select id="create-resource-type">' + options + '</select></label></div><textarea id="create-resource-yaml" class="cr-yaml" spellcheck="false">' + escapeHtml(runtime.createYaml) + '</textarea>' + (runtime.createPreview ? '<pre class="cr-create-diff">' + escapeHtml(runtime.createPreview.diff) + '</pre>' : '') + '<div class="cr-dialog-actions"><button class="button" data-close-resource-create>取消</button><button class="button" data-preview-resource-create>预览</button><button class="button primary" data-create-resource ' + (!runtime.createPreview ? 'disabled' : '') + '>添加到环境</button></div></div></div>'
  }

  function resourceOperationContent() {
    const options = containerEnvironments().map(item => '<option value="' + item._apiId + '" ' + (String(runtime.environmentId) === String(item._apiId) ? 'selected' : '') + '>' + escapeHtml(item.name + ' · ' + item.ip) + '</option>').join('')
    const addDisabled = !runtime.serviceKey || runtime.serviceKey.startsWith('group:')
    return pageTitle('服务资源', '发现、查看并修改容器环境中的 Kubernetes 资源。', '<span class="badge green">API Discovery</span>')
      + '<section class="cr-context"><label><span>容器环境</span><select id="resource-environment">' + options + '</select></label><label><span>命名空间</span><input id="resource-namespace" value="' + escapeHtml(runtime.namespace) + '"></label><button class="button" data-refresh-resource-discovery ' + (runtime.loading ? 'disabled' : '') + '>刷新 Discovery</button></section>'
      + (runtime.error ? '<div class="cr-error">' + escapeHtml(runtime.error) + '</div>' : '')
      + '<section class="cr-workbench"><aside class="cr-services"><div class="cr-pane-title"><strong>服务</strong><span>' + runtime.services.length + '</span></div><div class="cr-search"><input id="resource-service-search" value="' + escapeHtml(runtime.serviceQuery) + '" placeholder="搜索服务名称"></div><div class="cr-scroll">' + serviceRows() + '</div></aside>'
      + '<aside class="cr-resources"><div class="cr-pane-title"><div><strong>' + escapeHtml(selectedServiceName()) + ' 的资源</strong><span>按服务归集</span></div><button class="button primary small" data-open-resource-create ' + (addDisabled ? 'disabled' : '') + '>＋ 新增</button></div><div class="cr-search"><input id="resource-item-search" value="' + escapeHtml(runtime.resourceQuery) + '" placeholder="搜索该服务的资源"></div><div class="cr-scroll">' + resourceRows() + '</div></aside>'
      + '<main class="cr-editor">' + editorContent() + '</main></section>' + createDialog()
  }

  const previousCommonPage = commonPage
  commonPage = function (page) {
    return page === 'operations' ? resourceOperationContent() : previousCommonPage(page)
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-page="operations"]')) setTimeout(() => loadWorkspace(false), 0)
    if (event.target.closest?.('[data-refresh-resource-discovery]')) return loadWorkspace(true)
    const service = event.target.closest?.('[data-resource-service]')
    if (service) { runtime.serviceKey = service.dataset.resourceService; return loadResources() }
    const item = event.target.closest?.('[data-resource-item]')
    if (item) { runtime.resource = runtime.resources.find(candidate => [candidate.group, candidate.resource, candidate.name].join('/') === item.dataset.resourceItem); return readResource() }
    const tab = event.target.closest?.('[data-resource-tab]')
    if (tab) { runtime.tab = tab.dataset.resourceTab; return render(false) }
    if (event.target.closest?.('[data-reread-resource]')) return readResource()
    if (event.target.closest?.('[data-preview-resource]')) return previewUpdate()
    if (event.target.closest?.('[data-apply-resource]')) return applyUpdate()
    if (event.target.closest?.('[data-open-resource-create]')) return openCreate()
    if (event.target.closest?.('[data-close-resource-create]')) { runtime.createOpen = false; return render(false) }
    if (event.target.closest?.('[data-preview-resource-create]')) return previewCreate()
    if (event.target.closest?.('[data-create-resource]')) return createResource()
  })

  document.addEventListener('change', event => {
    if (event.target.id === 'resource-environment') { runtime.environmentId = event.target.value; return loadWorkspace(false) }
    if (event.target.id === 'create-resource-type') { runtime.createTypeKey = event.target.value; resetCreateYaml(); return render(false) }
  })

  document.addEventListener('input', event => {
    if (event.target.id === 'resource-namespace') runtime.namespace = event.target.value
    if (event.target.id === 'resource-service-search') { runtime.serviceQuery = event.target.value; renderSearch(event.target.id, event.target.selectionStart) }
    if (event.target.id === 'resource-item-search') { runtime.resourceQuery = event.target.value; renderSearch(event.target.id, event.target.selectionStart) }
    if (event.target.id === 'resource-yaml-editor') runtime.yaml = event.target.value
    if (event.target.id === 'create-resource-yaml') runtime.createYaml = event.target.value
  })

  const style = document.createElement('style')
  style.textContent = '.cr-context{display:grid;grid-template-columns:minmax(280px,1.4fr) minmax(180px,.7fr) auto;align-items:end;gap:12px;padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:9px 9px 0 0}.cr-context label{display:grid;gap:6px}.cr-context label span,.cr-create-context span{color:var(--muted);font-size:12px}.cr-context select,.cr-context input,.cr-create-context select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.cr-workbench{display:grid;grid-template-columns:250px 310px minmax(480px,1fr);height:calc(100vh - 190px);min-height:620px;background:var(--surface);border:1px solid var(--line);border-top:0;border-radius:0 0 9px 9px;overflow:hidden}.cr-services,.cr-resources{display:flex;min-width:0;flex-direction:column;border-right:1px solid var(--line)}.cr-pane-title{min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}.cr-pane-title>div{display:grid;gap:3px}.cr-pane-title span{color:var(--muted);font-size:12px}.cr-search{padding:10px;border-bottom:1px solid var(--line)}.cr-search input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px}.cr-scroll{flex:1;overflow:auto}.cr-group-label{padding:8px 12px;color:var(--muted);background:var(--surface-soft);font-size:12px}.cr-scroll button{position:relative;width:100%;min-height:66px;display:grid;gap:3px;border:0;border-bottom:1px solid var(--line);padding:10px 12px;color:inherit;background:var(--surface);text-align:left}.cr-scroll button:hover{background:var(--surface-soft)}.cr-scroll button.active{background:#edf3ff;box-shadow:inset 3px 0 var(--brand)}.cr-scroll button strong,.cr-scroll button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cr-scroll button span{color:var(--muted);font-size:12px}.cr-scroll button em{position:absolute;right:10px;top:10px;color:var(--green);font-size:11px;font-style:normal}.cr-empty,.cr-editor-empty{display:grid;place-items:center;padding:42px;color:var(--muted)}.cr-editor{display:flex;min-width:0;flex-direction:column}.cr-editor-empty{flex:1}.cr-editor-head{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 16px;border-bottom:1px solid var(--line)}.cr-editor-head h2{margin:0;font-size:17px}.cr-editor-head p{margin:3px 0 0;color:var(--muted);font-family:Consolas,monospace;font-size:12px}.cr-editor-head>div:last-child{display:flex;gap:8px}.cr-warning,.cr-error{padding:8px 14px;color:#996312;background:#fff7df;font-size:12px}.cr-error{margin-top:8px;border-radius:7px;color:var(--red);background:#fff0f0}.cr-tabs{height:44px;display:flex;align-items:end;gap:4px;padding:0 14px;border-bottom:1px solid var(--line)}.cr-tabs button{height:44px;border:0;border-bottom:2px solid transparent;padding:0 10px;color:var(--muted);background:transparent}.cr-tabs button.active{border-color:var(--brand);color:var(--brand);font-weight:600}.cr-tabs span{margin:auto 0 auto auto;color:var(--muted);font-family:Consolas,monospace;font-size:11px}.cr-yaml{width:100%;min-height:0;flex:1;resize:none;border:0;outline:0;padding:16px 18px;color:#cbd6dc;background:#1d2b34;font:13px/1.65 "Cascadia Code",Consolas,monospace;tab-size:2}.cr-diff{display:flex;min-height:0;flex:1;flex-direction:column;gap:10px;padding:16px;background:var(--surface-soft)}.cr-diff pre,.cr-create-diff{min-height:0;overflow:auto;margin:0;padding:14px;color:#d8e1e6;background:#1d2b34;font:12px/1.6 Consolas,monospace}.cr-diff pre{flex:1}.cr-diff span{color:#996312;font-size:12px}.cr-diff .button{align-self:flex-end}.cr-modal{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:24px;background:rgba(23,34,42,.38)}.cr-dialog{width:min(760px,100%);max-height:92vh;display:flex;flex-direction:column;padding:18px;background:var(--surface);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.2)}.cr-dialog-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.cr-dialog-head h2{margin:0}.cr-dialog-head button{border:0;background:transparent;font-size:24px}.cr-create-context{display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:12px}.cr-create-context label{display:grid;gap:6px}.cr-create-context strong{padding:7px 0}.cr-dialog .cr-yaml{height:390px;flex:none}.cr-create-diff{max-height:150px;margin-top:12px}.cr-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}@media(max-width:1200px){.cr-workbench{grid-template-columns:220px 270px minmax(420px,1fr)}}'
  document.head.appendChild(style)
  render(false)
  if (state.page === 'operations') loadWorkspace(false)
})()
