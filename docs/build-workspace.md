# 构建工作区

构建工作区使用资源中心的构建环境，通过 `huawei` 账号在远端执行单分支构建或双分支对比构建。

## 单一信息源

- 固定仓库、默认分支和构建命令：`BuildDefinition`
- 8 个模块和 `charts_path` 映射：`application.yml` 的 `build.modules`
- 分支格式规则：`BranchName`
- 构建步骤与失败规则：`BuildApplicationService`
- 页面结构与样式：根目录 `index.html`
- 构建页面真实交互：`frontend/src/prototype-runtime.js`

## 运行边界

- 每个任务在构建环境工作目录下使用独立任务目录。
- 模块在 `ArchDesign/Chart/{module}` 下构建，命令固定为 `mvn clean install -Dmaven.test.skip=true -Dbuild.package.type=DOCKER`。
- 单分支成功后持久化构建产物，产物目录为 `ArchDesign/Chart/{module}/target/{charts_path}`。
- 双分支使用独立子目录并发执行；任一侧失败时整体失败，不执行对比。
- 对比使用 ArchDesign 目录，`diff` 返回存在差异时仍视为对比成功。
- 状态、步骤和日志仅保存在进程内，通过 SSE 实时发送；服务重启后不恢复。
- SSH 密码只来自资源中心，不进入构建请求和日志。

## API

- `GET /api/build-configuration`
- `GET /api/build-artifacts`
- `POST /api/build-tasks`
- `GET /api/build-tasks/{id}`
- `GET /api/build-tasks/{id}/events`
