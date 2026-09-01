# 服务资源工作区

服务资源工作区以容器环境和命名空间为实时数据边界，以服务为资源归集入口。页面由 `frontend/src/container-resource-runtime.js` 提供，后端边界位于 `backend/src/main/java/com/jokter/containerops/containerresource`。

## 数据来源

- 资源类型来自 Kubernetes API Discovery，按容器环境缓存五分钟；“刷新 Discovery”会更新缓存。
- 服务优先来自 Helm Release，没有 Release 的控制器工作负载作为服务补充来源。
- 资源归属从 Helm 清单和 Kubernetes 推荐标签派生，不持久化第二套归属数据。
- 公共资源、未归属资源和集群级资源由 `ServiceOwnershipResolver` 统一分类。

## 写入规则

- 现有资源以读取时的 `resourceVersion` 作为并发修改边界。
- 预览和同步分别执行服务端 dry-run 与 Diff；同步前再次校验 `resourceVersion`。
- 新增资源写入 `app.kubernetes.io/name` 服务标签，不伪造 Helm 归属。
- 写操作只修改所选环境，不回写 Chart。

## API

- `GET /api/container-resource-services`
- `GET /api/container-service-resources`
- `GET /api/container-resource-types`
- `GET /api/container-resources`
- `POST /api/container-resource-changes/preview`
- `POST /api/container-resource-changes/apply`
- `POST /api/container-resources/preview`
- `POST /api/container-resources`
