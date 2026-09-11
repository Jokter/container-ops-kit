# Auto-UT 工作区

Auto-UT 位于“自动化工具”平台域。用户上传已有的 Grafana UT CSV，通过网页目录浏览器选择本机工作目录并查看扫描计划，再以手动、自动或每日定时方式创建修复任务。系统不采集 Grafana 数据，也不自动合并 CodeHub MR。

## 单一信息源

- 领域状态与执行历史：`backend/src/main/java/com/jokter/containerops/autout/domain/model`
- 扫描、任务创建与查询入口：`AutoUtApplicationService`
- Git、Pi、测试门禁和 CodeHub MR 工作流：`LocalAutoUtWorkflow`
- 仓库、范围、命令、目录和门禁配置：`application.yml` 的 `auto-ut`
- 页面与交互：根目录 `index.html`
- 持久化结构：`V5__auto_ut_task.sql`、`V6__auto_ut_execution.sql`、`V7__auto_ut_schedule.sql`、`V8__auto_ut_schedule_branch.sql`

## 运行边界

- CSV 只选择配置语言与 PL 组中存在失败用例或覆盖率缺口的仓库。
- 每个仓库创建一个独立任务；未配置仓库记录为“仓库未配置”，不会执行外部命令。
- 网页目录浏览器从本机文件系统根目录开始浏览，不使用配置初始目录，也不依赖服务端桌面窗口；每个仓库的工作目录固定派生为 `{所选目录}/{repository}`。
- CSV 中的每个仓库创建独立任务，并分别保留工作目录、进度、关键事件与 CodeHub MR 地址。
- 默认手动模式每完成一个关键阶段即暂停并释放执行线程；自动模式使用同一状态机连续推进。
- 基础分支由用户在执行输入中统一指定，并作为扫描、立即执行和每日定时执行的唯一来源。
- 每日定时配置保存 CSV 快照、用户名、单号、基础分支、工作目录和北京时间；到点后使用现有任务创建用例以自动模式执行，同一天最多触发一次。
- 修复分支固定派生为 `{baseBranch}_{username}_{ticket}`。
- Pi 只处理需要推理的 UT 修复，并只接收生成的提示词和基线失败证据；模型与认证沿用本机 Pi 配置。
- Git 操作、测试执行、修改门禁、提交以及 CodeHub MR 创建均由固定代码执行，不交给 Pi 决策。
- Pi 使用 RPC 模式执行；思考、回复和工具事件通过 SSE 实时展示，回复开始后思考区域自动折叠，也可手动展开。
- 修改门禁只接受 `src/test`，拒绝删除测试、新增禁用标记、显式恒真断言、减少测试方法或断言。
- 完整验证必须无失败、无错误、无跳过，且 JaCoCo 行覆盖率与分支覆盖率均达到 CSV 目标。
- 验证通过后使用 `codehub-cli mr upload` 完成上传与 MR 创建，并检查 reviewer/approver 配置；系统不会自动合并 MR。
- 任务和状态历史保存在 H2；命令输出与 Pi 提示词写入 `auto-ut.log-directory/{taskId}`。

## CodeHub 配置

- 运行服务的账号需先完成 `codehub-cli auth login --w3 --all`，可用 `codehub-cli auth status` 检查。
- CSV 的“代码仓”列通过 `auto-ut.repository-template.url` 自动映射为 CodeHub clone URL。默认模板为 `ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/{repository}.git`，例如 `FMInsightService` 会映射为 `ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/FMInsightService.git`。
- 扫描计划直接显示默认地址并允许修改。用户保存后，地址写入 `auto_ut_repository_mapping`；以后扫描或执行同名代码仓时优先使用数据库中的上次地址。
- 特殊仓库仍可在 `auto-ut.repositories` 中配置独立的默认 URL、测试命令和验证命令；用户保存的映射地址优先级最高。
- `AUTO_UT_CODEHUB_REVIEWERS`、`AUTO_UT_CODEHUB_APPROVERS`、`AUTO_UT_CODEHUB_ASSIGNEES`：可选，值为逗号分隔的员工 ID 或用户名。

## API

- `POST /api/auto-ut/scan`
- `POST /api/auto-ut/tasks`
- `POST /api/auto-ut/tasks/{id}/continuation`
- `PUT /api/auto-ut/repositories/{repository}`
- `GET /api/auto-ut/workspace-directories`
- `GET /api/auto-ut/schedule`
- `PUT /api/auto-ut/schedule`
- `DELETE /api/auto-ut/schedule`
- `GET /api/auto-ut/tasks`
- `GET /api/auto-ut/tasks/{id}`
- `GET /api/auto-ut/tasks/{id}/events`（SSE）
