export function canConvertFailedQuickDeploymentToReview(task) {
  if (task?.mode !== 'QUICK' || task?.status !== 'FAILED') return false
  const services = Object.values(task.services || {})
  return services.some(service => (service?.unresolvedImages || []).length)
    && services.every(service => service && !(service.errors || []).length && !service.stageError)
}
