# TypeScript 重构与数据迁移

## 完成状态

Java 兼容代理已经移除，全部 `/api` 业务由 TypeScript/Fastify 原生实现。运行时只需要 Node.js 24.15+（24.x）；不再启动 8081 端口，也不需要 JDK 或 Maven。

SQLite 默认位于 `data/platform/tasks.sqlite`，保存环境、构建历史与产物、Auto-UT 配置/任务、部署任务及可重放事件。数据库使用 WAL 和独占锁，避免两个进程同时认领任务。服务重启不会自动重复构建、部署或提交 MR。

## 旧 H2 数据

`npm run migrate` 会检查 `backend/data/resource-center.mv.db`。没有旧库时直接成功返回；SQLite 已有环境数据时不会覆盖。

首次迁移旧库需要本机仍能执行 `java`，并能在 Maven 本地缓存中找到 H2 JDBC jar（通常旧版项目运行过即已存在）。脚本只读取 H2，迁移环境、构建历史/产物和 Auto-UT 仓库映射；旧 H2 文件不会删除。迁移使用临时 CSV，完成或失败后均清理。

如果检测到旧库但缺少 JDBC jar，启动会停止并保留数据。可临时运行旧提交以准备 Maven 缓存，然后回到当前版本再次执行 `npm run migrate`。

迁移成功并核对页面前，请备份 `backend/data/resource-center.mv.db`。Auto-UT 运行中的 Pi 事件、旧部署内存任务和旧定时任务二进制报告无法可靠转换；它们不会被自动重放，需重新发起或重新设置定时任务。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PLATFORM_PORT` | `8080` | 后端监听端口 |
| `PLATFORM_DATA_DIR` | `data/platform` | SQLite 数据目录 |
| `PLATFORM_WORKERS` | `2` | 通用只读任务 Worker 数，范围 1–16 |
| `PLATFORM_TASK_TIMEOUT_MS` | `300000` | 通用任务超时，单位毫秒 |
| `AUTO_UT_CODEHUB_REVIEWERS` | 空 | CodeHub reviewers |
| `AUTO_UT_CODEHUB_APPROVERS` | 空 | CodeHub approvers |
| `AUTO_UT_CODEHUB_ASSIGNEES` | 空 | CodeHub assignees |

## 安全与运行边界

- HTTP 入口只接受本机 Host/Origin，未实现公网认证。
- SSH、Git、Maven、Pi、kubectl、Helm 和 CodeHub 命令由后端固定生成，HTTP 调用者不能传入任意 executable。
- 部署和资源变更不自动重试；更新 Kubernetes 资源时校验 `resourceVersion`。
- 关闭或超时时会终止本地子进程树；远端 SSH 命令使用固定超时和取消信号。
- 密码存放在本机 SQLite 以兼容原产品行为，应限制文件系统权限并纳入受控备份。

## 验证范围

自动测试覆盖本机 API、运行时校验、SQLite 生命周期、取消/超时、SSE 重放、目录边界及前端交互。SSH/Kubernetes/Helm/Pi/CodeHub 需要在具有公司网络和对应 CLI 的目标机器做一次验收；自动测试不会假装执行生产部署。
