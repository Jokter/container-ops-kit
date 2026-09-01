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
- CBB-Web-Dev 在 `CBB-Web-Dev/chart-codegen-plugin` 下构建，ArchDesign 在 `ArchDesign/Chart/{module}` 下构建；命令固定为 `mvn clean install -Dmaven.test.skip=true -Dbuild.package.type=DOCKER`。
- 单分支成功后持久化构建产物，产物目录为 `ArchDesign/Chart/{module}/target/{charts_path}`。
- 双分支使用独立子目录并发执行；任一侧失败时整体失败，不执行对比。
- 对比使用 ArchDesign 目录，`diff` 返回存在差异时仍视为对比成功。
- 任务摘要和步骤保存在 H2，实时日志通过 SSE 发送且只保留在当前进程；服务重启后不再展示旧日志，原来仍在等待或运行的任务统一标记为失败，不恢复远端进程，也不继续执行产物对比。
- 历史任务可查看详情、复制任务根目录或各编译目录、只删除记录，或清理远端任务目录后删除记录。
- 构建页通过当前构建环境实时读取 `/user/wytest` 的目录占用和所在文件系统可用空间。
- SSH 密码只来自资源中心，不进入构建请求和日志。

## API

- `GET /api/build-configuration`
- `GET /api/build-artifacts`
- `POST /api/build-tasks`
- `GET /api/build-tasks`
- `GET /api/build-tasks/{id}`
- `DELETE /api/build-tasks/{id}?deleteWorkspace=false`
- `GET /api/build-tasks/{id}/events`
- `GET /api/build-environments/{id}/storage`
