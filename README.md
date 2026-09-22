# Container Ops Kit 运维平台

本项目已完成后端 TypeScript 重构。资源中心、SSH 连接、远程构建、容器资源、部署、Auto-UT/Pi 和持久化任务均由一个 Node.js 进程提供，不再需要 Java、Maven 或 Spring Boot。

## 启动

需要 Node.js 24.15+（24.x）和 npm。Windows 双击 `start.bat`，脚本会按锁文件安装依赖、迁移检测到的旧 H2 数据、编译后端，然后启动：

- TypeScript 后端：`http://127.0.0.1:8080`
- Vite 前端：`http://127.0.0.1:5173`

手动启动：

```bash
npm ci
npm run migrate
npm run build
npm start
```

另开终端启动前端：

```bash
npm ci --prefix frontend
npm run dev --prefix frontend -- --host 127.0.0.1
```

## 结构

- `backend-ts/src/modules/environment`：环境配置和 SSH 连接测试
- `backend-ts/src/modules/build`：远程构建、产物与可重放 SSE
- `backend-ts/src/modules/containerresource`：Kubernetes/Helm 资源发现、预览和变更
- `backend-ts/src/modules/deployment`：Chart 补全、审阅、渲染和串行部署
- `backend-ts/src/modules/autout`：CSV 扫描、Pi 修复、测试门禁和 CodeHub MR
- `backend-ts/src/platform`：SQLite、独立 Worker和通用只读任务
- `shared`：前后端共享的数据约定
- `frontend` 与根目录 `index.html`：现有 Vue/Vite 页面

SQLite 默认写入 `data/platform/tasks.sqlite`。数据库使用进程独占锁，不能同时启动两个后端。服务只允许本机浏览器来源；它没有多用户认证，不能直接暴露到公网。

## 日志

运行日志统一写入项目根目录的 `data/logs`，同时继续显示在启动窗口和页面中。每次运行 `start.bat` 都会先清空该目录，确保导出的日志只包含本次运行：

- `startup/startup.log`：依赖安装、数据迁移和编译
- `backend/process.log`：Node.js 后端进程启动输出
- `backend/backend.jsonl`：Fastify 请求与服务异常，JSON Lines 格式
- `frontend/frontend.log`：Vite 前端进程输出
- `platform/{taskId}.jsonl`：通用平台任务事件
- `build/{taskId}.jsonl`：构建步骤和远程命令输出
- `deployment/{taskId}.jsonl`：分析、编辑、渲染和部署输出
- `auto-ut/{taskId}.jsonl`：Auto-UT 阶段与实时事件
- `auto-ut/details/{taskId}/*.log`：Git、Maven、Pi 和 CodeHub 命令的完整输出

JSON 日志会按敏感字段名脱敏。诊断时优先发送对应任务 ID 的日志文件，不要发送包含环境密码的 `data/platform/tasks.sqlite`。

旧 H2 数据的迁移和限制见 [TypeScript 迁移说明](docs/typescript-migration.md)。构建、部署和 Auto-UT 的业务约束见 `docs/` 下对应文档。

## 验证

```bash
npm run check
npm run test --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

SSH 用户名仍按环境类型固定：构建环境使用 `huawei`，容器环境连接测试使用 `sopuser`，Kubernetes/Helm 操作使用 `root`。密码不会写入应用日志。

构建产物下载和双分支文件对比要求远端构建环境提供 `python3`（仅使用标准库）。服务目录按需打包；已有 `.tgz` / `.tar.gz` 包原样下载。批量下载返回包含各服务包的 `.tar.gz`；包内链接或越界路径会拒绝处理。对比结果保存在 SQLite，文本差异有大小限制，截断或二进制文件会提示下载原包查看。
