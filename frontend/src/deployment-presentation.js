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
    const placeholders = [...String(service.values || '').matchAll(/\{[A-Za-z0-9_:.-]+}|replaceByOssDiy/g)].map(match => match[0])
    for (const placeholder of new Set(placeholders)) blockers.push(name + '：仍有未解析占位符 ' + placeholder)
  }
  return [...new Set(blockers)]
}

export function canDeployReviewedTask(task) {
  return task?.mode === 'REVIEW'
    && task?.status === 'AWAITING_REVIEW'
    && deploymentReviewBlockers(task).length === 0
}
