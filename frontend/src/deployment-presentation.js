export function canConvertFailedQuickDeploymentToReview(task) {
  if (task?.mode !== 'QUICK' || task?.status !== 'FAILED') return false
  const services = Object.values(task.services || {})
  return services.some(service => (service?.unresolvedImages || []).length)
    && services.every(service => service && !(service.errors || []).length && !service.stageError)
}

export function deploymentReviewBlockers(task) {
  if (task?.mode !== 'REVIEW' || task?.status !== 'AWAITING_REVIEW') return []
  const blockers = []
  for (const [name, service] of Object.entries(task.services || {})) {
    if (!service) {
      blockers.push(name + '：仍在分析')
      continue
    }
    for (const error of service.errors || []) blockers.push(name + '：' + error)
    if (service.stageError) blockers.push(name + '：' + service.stageError)
    if (service.stage !== 'ANALYZED' && !(service.errors || []).length && !service.stageError) {
      blockers.push(name + '：当前阶段为 ' + service.stage)
    }
    const placeholders = [...String(service.values || '').matchAll(/\{[A-Za-z0-9_:.-]+}|replaceByOssDiy/g)]
      .map(match => match[0])
      .filter(placeholder => !/^\{version:[A-Za-z0-9_.-]+}$/.test(placeholder))
    for (const placeholder of new Set(placeholders)) blockers.push(name + '：仍有未解析占位符 ' + placeholder)
  }
  return [...new Set(blockers)]
}

export function deploymentReviewWarnings(task) {
  if (task?.mode !== 'REVIEW' || task?.status !== 'AWAITING_REVIEW') return []
  const warnings = []
  for (const [name, service] of Object.entries(task.services || {})) {
    const fromValues = [...String(service?.values || '').matchAll(/\{version:([A-Za-z0-9_.-]+)}/g)].map(match => match[1])
    for (const image of new Set([...(service?.unresolvedImages || []), ...fromValues])) warnings.push(name + '：未找到 {version:' + image + '}，作为可选配置继续，后续由 Helm 渲染校验')
  }
  return warnings
}

export function deploymentProgress(task, logs = []) {
  if (!task) return {percent: 0, label: '尚未开始'}
  if (task.status === 'SUCCEEDED') return {percent: 100, label: '部署成功'}
  if (task.status === 'FAILED') return {percent: 100, label: '部署失败'}
  if (task.status === 'PENDING') return {percent: 5, label: '等待分析'}
  if (task.status === 'ANALYZING') return {percent: 15, label: '正在分析和补全配置'}
  if (task.status === 'AWAITING_REVIEW') return {percent: 25, label: '等待确认配置'}
  const latest = logs.at(-1)
  if (latest?.stage === 'APPLY') return {percent: 40, label: latest.service + ' · 正在生成 Chart'}
  if (latest?.stage === 'RENDER') return {percent: 55, label: latest.service + ' · 正在执行 Helm 渲染校验'}
  if (latest?.stage === 'DEPLOY') {
    const step = Number(String(latest.message || '').match(/^\[(\d)\/5]/)?.[1] || 0)
    const labels = ['正在准备部署', '再次渲染校验', '卸载旧 release', '检查待接管资源', '安装 Helm release', '等待工作负载就绪']
    return {percent: step ? 55 + step * 8 : 60, label: latest.service + ' · ' + labels[step]}
  }
  return {percent: task.status === 'DEPLOYING' ? 60 : 30, label: task.status === 'DEPLOYING' ? '正在部署' : '正在准备 Chart'}
}

export function canDeployReviewedTask(task) {
  return task?.mode === 'REVIEW'
    && task?.status === 'AWAITING_REVIEW'
    && deploymentReviewBlockers(task).length === 0
}
