# Container Ops Kit 运维平台

本项目已完成后端 TypeScript 重构。资源中心、SSH 连接、远程构建、容器资源、部署、Auto-UT/Agent 和持久化任务均由一个 Node.js 进程提供，不再需要 Java、Maven 或 Spring Boot。

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
- `backend-ts/src/modules/autout`：CSV 扫描、Agent 修复、测试门禁和 CodeHub MR
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
- `automation/group-mr-monitor.jsonl`：群组 MR 监听轮询、过滤数量、命令状态和错误（不记录群消息正文）；页面“群组 MR 检视 → 监听日志”展示最近 100 条
- `auto-ut/{taskId}.jsonl`：Auto-UT 阶段与实时事件
- `auto-ut/details/{taskId}/*.log`：Git、Maven、Agent 和 CodeHub 命令的完整输出

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

## 个人账号与工作空间

项目根目录直接提供 `auth-config.json`，已配置白名单账号 `w00789509`，无需复制或重命名文件；启动前在本地填写约定的统一密码，仓库不包含明文密码。可在此文件维护白名单；部署后的个人配置也可通过 `PLATFORM_AUTH_FILE` 指向被 Git 忽略的 `auth-config.local.json`：

```json
{
  "defaultPassword": "填写约定的统一密码",
  "allowedAccounts": ["a123456", "b234567"],
  "adminAccounts": ["a123456"]
}
```

示例中的账号需替换为真实工号：2–40 位，以英文字母开头，后续为字母、数字、下划线或短横线，统一转为小写。默认白名单包含 `w00789509`；白名单为空时不允许任何账号登录。配置修改无需重启；移除账号或修改密码后，其已有会话失效。移除账号会在 5 秒内停止其后台服务。退出登录只结束浏览器会话，已经发起的后台任务继续执行。服务器重启后需要重新登录，未完成的外部写操作不会自动重放。

登录后保留现有工作台样式和交互。WeLink 授权账号、UT 执行用户名、通知本人账号由后端绑定为登录账号，不能通过修改请求冒用别人。登录密码用于 Ops Studio 本身；WeLink、CodeHub、DTS、Agent 仍需要该用户各自的真实服务授权。

- 用户数据库、设置、执行记录、日志和 Agent 会话：`data/platform/users/<账号>/`。
- Grafana Token 认证按用户读取 `QUALITY_GRAFANA_TOKEN_<大写账号>`，例如 `QUALITY_GRAFANA_TOKEN_A123456`，不回退到共享 Token。
- 各用户的 CLI HOME / USERPROFILE：`data/platform/users/<账号>/home/`。不沿用启动服务器账号的 CLI 登录缓存或 WeLink 环境 Token。需要外部 CLI 配置时在对应 HOME 下配置；Windows 同时指定 USERPROFILE / APPDATA / LOCALAPPDATA。平台执行 CLI 时自动使用这些目录。
- 本地默认任务目录：Linux 为 `/usr1/wytest/<账号>`；Windows 为项目下 `data/workspaces/<账号>`。可用 `PLATFORM_WORK_ROOT` 指定公共父目录，程序追加账号。目录浏览和 UT 写入限制在当前账号根目录内，拒绝路径穿越和指向其它用户目录的符号链接。
- 新环境的默认远端工作目录：`/usr1/wytest/<账号>`；可用 `PLATFORM_REMOTE_WORK_ROOT` 指定父目录。管理员配置的远端主机和集群仍受实际 SSH / Kubernetes 权限约束。
- 浏览器缓存按账号保存，切换账号会重新加载页面。所有业务 API、日志下载和 SSE 均经过登录校验；用户不能读取、删除或继续别人的任务。

### 管理员

通过 `adminAccounts` 配置管理员，账号必须同时在 `allowedAccounts` 中；不配置时默认为空。仓库默认将 `w00789509` 设为管理员，本地旧配置需自行添加该字段。

```json
"adminAccounts": ["w00789509"]
```

管理员正常使用自己的工作空间，顶部额外显示“用户管理”。可只读查看所有用户（含已移出白名单的历史用户）的登录次数、最近登录、最近任务活动、环境和计划数量，以及 UT、MR、质量检查、报告、构建、部署、平台任务和定时执行记录。支持按用户、任务类型分页查看；不提供跨用户执行或删除操作，不返回连接密码、Token 和原始日志。登录统计从本版本开始累计。管理员权限修改即时生效，刷新页面更新入口。

用户迁移脚本已移除，已迁移数据及原数据库、备份目录不受影响。

登录页会读取 `auth-config.json` 中的公共密码并自动填写，密码框使用掩码显示，用户只需输入白名单账号。该密码不再作为保密凭据；知道白名单账号的人即可使用该账号登录，包括管理员账号，请仅在可信访问范围内使用此模式。

### WeLink 诊断日志

用户日志位于 `data/platform/users/<账号>/logs/automation/`（自定义数据目录时随之变化）。`group-mr-monitor.jsonl` 记录群监听，`group-mr-errors.jsonl` 记录监听和 MR 处理错误；`welink-mcp.jsonl` 记录 MCP 启动、初始化、工具查询和发送确认阶段。MCP 页面失败提示附诊断编号，可以据此定位日志。日志只记录阶段、耗时、退出码和固定类别的错误提示，不记录 Token、消息正文或 MCP 原始输出。初始化失败会注明尚未提交发送请求，发送后的异常仍按结果未确认处理，不自动重发。

WeLink MCP 在独立用户 HOME 下运行，同时通过 `uv cache dir` / `uv python dir` 复用启动后端的系统用户已经安装的 uv 包缓存和 Python 运行时。仅共享这两个运行环境目录，WeLink Token、用户配置和 CLI 登录缓存仍按账号隔离。可在启动后端前设置 `UV_CACHE_DIR`、`UV_PYTHON_INSTALL_DIR` 覆盖路径；未设置时自动探测，探测不安装依赖、不发送消息。需保证后端与手动验证 uvx 的终端使用同一系统用户。

### 外部工具的个人配置

平台登录只识别账号，不会自动生成 SSH 私钥或完成外部系统认证。已指定本机配置归属账号 `w00789509`：该账号首次初始化工作空间时自动补齐本机 SSH、Agent 和 Git 作者信息，完成后写入标记，不在每次启动时重复导入。其他账号不会自动继承本机凭据。后端必须由原工具配置所属的系统用户运行；缺少的凭据仍需本人配置。手动检查或补充配置时，请关闭后端，在原系统用户下运行 `setup-user-tools.bat w00789509`：先检查程序和个人配置，再按需选择导入本人配置或登录 WeLink CLI。其他账号必须用各自的凭据配置，不能把同一人的密钥批量导入白名单。

导入操作只向指定账号的 HOME 补齐 `.ssh`、`.pi/agent` 和 Git `user.name` / `user.email`。包括本人 SSH 密钥、已核验主机列表及 Agent 认证；不删除源文件、不覆盖已有文件、不复制符号链接或历史 Agent 会话。仅在目标账号属于当前系统用户本人时选择导入。Git 凭据助手、外部 include 路径不会从全局 Git 配置直接复制。

- Git SSH 显式使用个人 `.ssh/config`、`known_hosts` 和标准命名的密钥，不依赖 Windows 对 HOME 的隐式解析；严格主机校验始终开启，不自动接受或删除主机密钥。非标准密钥需在个人 SSH 配置中指定绝对路径。
- 后台不能弹出私钥口令框。加密私钥需由管理员为该账号指定独立代理：`PLATFORM_SSH_AUTH_SOCK_<大写账号>`；默认不继承机器共享 SSH agent。已知主机校验通过不代表 SSH 公钥已有仓库权限。
- WeLink CLI 可通过配置脚本的登录选项在个人 HOME 下完成登录。CodeHub、WeLink MCP、DTS 的 Token 仍通过当前账号页面保存，不能互相代替；CodeHub API Token 不等于 Git SSH 密钥。
- Agent 配置位于个人 HOME 的 `.pi/agent`；导入只补配置，不会启动 Agent 或发送消息。外部扩展中写死的绝对路径需自行核对。
- Maven 继续使用仓库内 `.ci/settings.xml` 和已有任务命令；Java/Maven 安装及本地依赖仓不是平台账号，当前修改不重写构建参数。Git 提交身份单独检查，避免克隆通过后在 commit 阶段才失败。

命令行也可分别执行：`node scripts/user-tools.mjs <账号> check`、`node scripts/user-tools.mjs <账号> import-local`、`node scripts/user-tools.mjs <账号> welink-login`。只有最后一项执行交互式认证；检查和导入不访问仓库、不发送消息、不创建工单。
