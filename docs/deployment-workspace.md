# 部署工作区

部署工作区将单分支成功构建产物补全为可部署 Chart，并通过容器环境 OM 节点执行覆盖式重装。页面由 `frontend/src/prototype-runtime.js` 注入，根目录 `index.html` 保持不变。

## 数据来源

- 编译机：`values.yaml`、`Chart.yaml`、业务模板、模块公共模板和模块根 `values.yaml`。
- OM：`/opt/pkg_version/lock.json`、`jarlist.json`、`crictl images` 和 `helm get values -a`。
- OM 固定使用资源中心配置的 `root` 密码，不使用 `sudo`。
- kubeconfig 固定为 `/opt/kubeconfig/kubeconfig.txt`。
- 命名空间通过 OM 上的 `kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name` 读取；失败时接口返回真实原因，不再降级为空列表。
- 服务选择使用可搜索的限高列表，默认不选择服务；支持选择当前搜索结果和清空选择。

构建产物定位规则：

```text
{taskRoot}/single/ArchDesign/Chart/{module}/target/{charts_path}/{service}
```

## 四阶段

1. 分析补全：采集构建机和 OM 数据，生成替换预览；未解析占位符保留并标记失败。
2. 生成 Chart：写入 `data/deployment-preparations/{prepId}/{service}`，不修改远端构建产物。
3. 渲染校验：上传到 OM 的独立临时目录并执行 `helm template`。
4. 确认并部署：二次确认后，多个服务串行执行；单服务失败不阻断后续服务。

部署阶段严格执行：

```text
render → helm uninstall → 删除冲突资源 → helm install → 轮询 ready
```

`ResourceClaim` 和 `LogResourceClaim` 分别使用完整资源类型 `resourceclaim.resource.sop.huawei.com` 和 `logresourceclaim.resource.sop.huawei.com`。

## API

- `GET /api/deployment-candidates`
- `POST /api/deployment-preparations`
- `GET /api/deployment-preparations/{id}`
- `PUT /api/deployment-preparations/{id}/services/{service}/values`
- `POST /api/deployment-preparations/{id}/apply`
- `POST /api/deployment-preparations/{id}/render`
- `POST /api/deployment-preparations/{id}/confirmation`
- `POST /api/deployment-preparations/{id}/deploy`
- `GET /api/deployment-preparations/{id}/events`
