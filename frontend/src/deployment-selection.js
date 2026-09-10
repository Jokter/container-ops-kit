const 键前缀 = 'container-ops-kit.deployment-selection'

function 选择键(环境标识, 模块) {
  return 键前缀 + '.' + encodeURIComponent(String(环境标识)) + '.' + encodeURIComponent(模块)
}

export function saveDeploymentSelection(存储, 选择) {
  存储.setItem(选择键(选择.environmentId, 选择.module), JSON.stringify(选择))
}

export function loadDeploymentSelection(存储, 环境标识, 模块) {
  const 内容 = 存储.getItem(选择键(环境标识, 模块))
  return 内容 == null ? null : JSON.parse(内容)
}
