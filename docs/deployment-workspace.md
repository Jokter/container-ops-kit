# 部署工作区

快速部署的交互、任务模型和接口设计见[开发环境快速部署设计](superpowers/specs/2026-09-02-fast-deployment-design.md)。

部署工作区将单分支成功构建产物补全为可部署 Chart，并通过容器环境 OM 节点执行覆盖式重装。快速部署自动执行完整流程；审阅部署在分析后允许修改 values，再继续执行。页面实现位于 `frontend/src/prototype-runtime.js`，根目录 `index.html` 负责绑定两个任务创建入口。

## 数据来源

- 编译机：`values.yaml`、`Chart.yaml`、业务模板、模块公共模板和模块根 `values.yaml`。
- OM：服务 `values.yaml` 中 `appg.name` 与 `processName` 定位的容器版本文件，以及按占位符读取的 `helm get values -a`；文件路径由 `deployment.lock-file`、`deployment.jar-list-file` 配置。
- 包版本以 `lock.json` 中目标架构的组件记录为准；环境占位符以模块对应 Helm release 的计算值为准。
- 候选服务沿用构建产物与 Pod 名前缀的既有匹配规则；同时读取命名空间中的 Deployment 和 StatefulSet 以展示可识别的工作负载类型。Pod 查询只读取 Pod 名、容器名、阶段、Ready 状态和镜像标识，不传输完整 Pod JSON。
- `lock.json` 仅在存在包版本占位符时读取；`jarlist.json` 仅在存在 `replaceByBuild` 时尝试读取，文件不存在时保持原值且不影响分析。
- 远程采集结果不逐行写入事件日志，只记录采集阶段、耗时和失败摘要。
- OM 固定使用资源中心配置的 `root` 密码，不使用 `sudo`。
- 华为 CCE/KMC 环境下必须拆分 kubeconfig，分别由 `deployment.kubectl-kubeconfig`、`deployment.helm-kubeconfig` 配置；两者不能互换。
- 命名空间通过 OM 上的 `kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name` 读取；失败时接口返回真实原因，不再降级为空列表。
- 服务选择只列出同时匹配构建产物和运行中 Pod 前缀的服务。命名空间变化时重新读取；默认不选择服务，支持选择当前搜索结果和清空选择。
- 快速部署在输入确认后自动完成全部阶段；审阅部署在分析补全后由用户检查并确认一次，再继续生成、渲染和串行部署。任一部署前阶段失败时不开始部署；快速部署存在未解析版本时可用原输入新建审阅任务。
- 浏览器恢复当前进程内仍存在的部署任务和事件序号，并按容器环境和模块恢复仍然有效的命名空间与服务选择。

构建产物定位规则：

```text
{taskRoot}/single/ArchDesign/Chart/{module}/target/{charts_path}/{service}
```

## 执行阶段

1. 分析补全：读取 `values.yaml`、`Chart.yaml` 和模块公共值，按实际占位符采集 OM 数据并生成替换预览；未解析版本占位符保留并标记失败。
2. 生成 Chart：延迟读取模板并写入 `data/deployment-preparations/{taskId}/{service}`，不修改远端构建产物。
3. 渲染校验：上传到 OM 的独立临时目录并执行 `helm template`。
4. 部署：多个服务串行执行；单服务失败不阻断后续服务，全部结束后汇总任务结果。

部署事件写入 SQLite 并通过 SSE 重放；后端控制台只记录请求元数据，不记录 values 或凭据。

部署阶段严格执行：

```text
render → helm uninstall → 删除冲突资源 → helm install → 轮询 ready
```

`ResourceClaim` 和 `LogResourceClaim` 分别使用完整资源类型 `resourceclaim.resource.sop.huawei.com` 和 `logresourceclaim.resource.sop.huawei.com`。

## API

- `GET /api/deployment-candidates`
- `POST /api/deployment-tasks`
- `GET /api/deployment-tasks/{id}`
- `PUT /api/deployment-tasks/{id}/services/{service}/values`
- `POST /api/deployment-tasks/{id}/execution`
- `GET /api/deployment-tasks/{id}/events`
