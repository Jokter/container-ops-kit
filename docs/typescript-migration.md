# TypeScript 渐进迁移：第一阶段

## 本次交付边界

这是可回退的第一阶段，不是已经去掉 Java 的最终版本。

| 能力 | 当前实现 |
| --- | --- |
| `/api/health` | TypeScript 聚合就绪检查，要求 Java 兼容后端也健康 |
| `/api/platform/health` | TypeScript 存活检查 |
| `/api/auto-ut/workspace-directories` | TypeScript 原生，保持原 JSON 结构 |
| `/api/platform/tasks` | 新增只读工作区检查任务，SQLite + 独立进程 |
| 构建配置、资源中心、SSH、构建、部署、Auto-UT | 仍由 Java 实现，通过流式代理承接 |
| 前端 | 保留现有页面与 API 调用；未新增平台任务页面 |

目录浏览不需要 Java，原任务及部署流程仍然需要。目录浏览保持原能力，可以浏览启动机器上的目录；这是本机工具，不应暴露为公共网络服务。

## 结构和依赖方向

- `shared/contracts.ts`：接口类型、Zod 校验、任务状态，不依赖后端。
- `backend-ts/src/modules/workspace`：本机目录浏览用例。
- `backend-ts/src/platform/store.ts`：SQLite 任务和事件的事务写入。
- `backend-ts/src/platform/tasks.ts`：排队、并发限制、超时、取消与 Worker 生命周期。
- `backend-ts/src/platform/worker.ts`：独立进程执行只读检查，只扫描一级目录，不读取文件内容。
- `backend-ts/src/platform/routes.ts`：原生任务 API 和可重放 SSE。
- `backend-ts/src/app.ts`：模块装配与临时 Java 兼容边界。

暂不提供任意 shell 命令执行 API。下一阶段应先迁移并测试确定的命令适配器，再接入构建与 Pi；不要让 HTTP 请求直接指定 executable/args。

## 数据与进程

旧 H2、仓库映射、调度和历史记录完全保留，由 Java 原逻辑读写。本次不导出、转换或删除 H2。必须沿用原启动工作目录，避免意外创建新的空 H2。

SQLite 默认位于仓库根目录 `data/platform/tasks.sqlite`，仅记录新平台任务和事件，不能将其当作旧 Java 数据库的替代品。备份时先停止 TypeScript 进程，再备份该目录。数据库使用 WAL 和进程独占锁，禁止多个后端同时打开同一数据库，避免误中断另一进程的任务；崩溃后操作系统释放锁。

任务生命周期：QUEUED → RUNNING → SUCCEEDED/FAILED；排队或运行中可取消。停止或重启后未完成任务变为 INTERRUPTED，绝不自动重试。旧 Java 任务的恢复能力没有因本次迁移而改变。

Worker 数量默认 2，执行超时默认 5 分钟；进程退出前等待已启动 Worker 清理。当前 Worker 不创建外部命令子进程，不能把其取消实现直接视为未来 Maven/Pi 进程树取消方案。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| PLATFORM_PORT | 8080 | TypeScript 端口 |
| LEGACY_BACKEND_URL | http://127.0.0.1:8081 | 仅接受本机 HTTP origin，不能与入口端口相同 |
| PLATFORM_DATA_DIR | data/platform | 相对启动目录解析 |
| PLATFORM_WORKERS | 2 | 1–16 个 Worker |
| PLATFORM_TASK_TIMEOUT_MS | 300000 | 100–3600000 毫秒 |

`start.bat` 固定入口与兼容端口为 8080/8081；自定义端口请手动启动并调整 Vite 代理。TypeScript 和批处理启动的 Java 只监听本机。无账号体系，不支持作为多用户网络服务直接发布。远程站点 Origin 与跨站浏览器请求会被拒绝。

## 新任务 API

- `POST /api/platform/tasks`：`{"kind":"workspace-inspect","path":"D:/Projects"}`，返回 202 和排队任务。
- `GET /api/platform/tasks?limit=100`：最近任务，最多 200 条。
- `GET /api/platform/tasks/{id}`：任务状态。
- `POST /api/platform/tasks/{id}/cancel`：幂等取消，不改变已完成结果。
- `GET /api/platform/tasks/{id}/events`：SSE，支持 Last-Event-ID 或 afterSequence，断线后读取持久化事件。

SSE 有背压控制和心跳，原生终态重放完毕后关闭。旧 Java SSE 直接流式转发，保持其现有关闭语义。代理不自动重试任何请求，避免重复部署或重复提交修复。

## 验证与交付

```bash
npm ci
npm run check
npm ci --prefix frontend
npm run test --prefix frontend
npm run build --prefix frontend
```

测试覆盖目录接口、输入校验、任务持久化、重启中断、取消、超时、SSE 重放、代理的 JSON/multipart/状态码/查询参数/中文 SSE，以及变更请求不重试。真实 SSH、公司网络、Windows 批处理和 Pi/CodeHub 执行仍需在用户环境验证，不能用代理桩测试声称已验证生产部署。

Node 日志输出到进程控制台，不记录请求体和查询参数；任务事件持久化到 SQLite。Java 原日志文件位置不变。

本次开发环境只有 Java 17，未安装 Maven，不能运行要求 Java 21 的原后端测试；原 Java 源码未修改。提交前已验证根目录类型检查、11 项后端测试、11 项前端测试、前端类型检查和生产构建。兼容代理测试使用本机 HTTP 测试服务器，不等于真实 Java/SSH 联调。

## 回退与后续阶段

停止 TypeScript、Java 和前端后，使用 `start-java.bat`，或原 `mvn -pl backend spring-boot:run` 加前端。无需回滚数据库，也不要删除 SQLite 或 H2。

后续依次迁移：环境配置/SSH → 构建 → Auto-UT/Pi → 部署。每个模块先建立接口和业务契约测试，再切换所有权；不要同时让两个实现写同一业务数据。H2 到 SQLite 的迁移必须单独实现导出、校验、备份和回退，完成前不删除 Java。最后才移除兼容代理、Maven 和 JDK 运行依赖。
