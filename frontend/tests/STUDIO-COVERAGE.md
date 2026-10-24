# Studio 正式迁移验证范围

本清单依据 2026-10-25 仓库中的测试代码整理。测试存在不等于本次运行通过；运行结果以测试命令输出为准。

## 三类测试入口

- 既有测试读取根 `index.html`，或分别加载 `prototype-runtime.js`、构建/部署展示模块。它们继续覆盖原业务行为，但不会执行 Vite 的 `transformIndexHtml`，因此不能代表新增 Studio 增强层已经运行。
- `studio-workspace`、`studio-container`、`studio-automation`、`studio-automation-flows`、`studio-mr`、`studio-tools-portal`、`studio-tools-parity`、`studio-applications` 使用 `helpers/studio-harness.mjs`。该工具打包正式 `frontend/src/studio-runtime.js`，与真实 `index.html` 一起执行；测试 API 响应通过独立 fixture 或测试内覆盖的 `fetch` 提供。未读取 `frontend/prototypes/ops-studio-prototype.html`。
- `studio-release.test.mjs` 使用正式 `frontend/vite.config.ts`、`build({write:false})`，检查发布 HTML、模块图及样式资产，并启动编译后的入口。它不修改 `frontend/dist`。

## 正式入口的行为覆盖

下列名称与测试源中的 `test(...)` 名称一致。

| 页面或能力 | 正式入口测试 | 已断言的行为 |
| --- | --- | --- |
| 20 个路由初始页面 | `studio-workspace` → `all 20 production routes preserve original business controls after layout changes` | 与未增强入口对比，保留原业务 `data-*` 控件及数量；初始导航仅 GET；无运行时错误。仅覆盖初始状态的控件存在性，不代表所有操作完成或所有控件可见。 |
| 共享单选菜单 | `studio-workspace` → `shared selects preserve native change semantics and dismiss on Escape/outside` | 键盘选择只触发一次原始 change；Esc、外部点击、焦点恢复。 |
| 全局搜索和历史导航 | `studio-workspace` → `global search, hash entry and history load build storage without retrying actions` | 搜索直达构建，浏览器返回保留路由，存储只读请求不重复。 |
| 移动导航 | `studio-workspace` → `navigation at 390px/650px/700px isolates background, restores focus and retains destinations` | 背景 inert、Esc、焦点恢复及导航目的地。此测试未模拟浏览器布局。 |
| 弹层跨路由清理 | `studio-workspace` → `leaving resource creation releases modal isolation on the home route` | 离开创建资源后解除 inert，全局搜索仍可打开。 |
| 构建 | `studio-container` → `正式构建布局保留表单、业务仓与 SSE，视觉刷新不重试读取或重放创建` | 表单节点/分支草稿、业务仓参数、一次 POST、SSE sequence 去重、对比分支和历史入口。 |
| 部署 | `studio-container` → `正式部署保留服务选择、Values 与审阅确认；错误和 SSE 重绘不重放部署` | 服务范围、禁用项、分析任务参数、Values 草稿与 PUT、revision、确认取消、执行失败不重放、历史入口。 |
| 服务资源 | `studio-container` → `服务资源保留真实坐标、版本校验、草稿和创建流程，弹层关闭恢复焦点` | YAML 原节点、行号、收起目录、预览坐标/resourceVersion、冲突不重试、创建预览与提交、Esc、共享资源限制。 |
| 环境管理 | `studio-container` → `环境管理保留账号测试、详情和删除确认，失败不自动重试` | 指定 SSH 用户参数、环境详情、确认取消、删除失败只请求一次。 |
| 构建清理 | `studio-container` → `构建历史删除及清理目录保持独立确认与原始 deleteWorkspace 参数` | 清理目录与仅删除记录保持独立操作，保留查询参数。 |
| 自动化概览 | `studio-automation` → `studio automation overview keeps loaded metrics, period requests and expandable statistics` | 原指标值/空值、周期 GET、刷新、统计展开状态，无写入。 |
| 执行记录 | `studio-automation` → `studio record cards retain selection, action confirmation and accessible menu dismissal` | 全选/部分选择、批量按钮状态、更多菜单外部关闭和 Esc、删除确认取消。 |
| 定时计划 | `studio-automation` → `studio schedule cards retain all fields, mutually exclusive menus and one revision-checked write` | 所有原字段及编辑/执行/历史入口、菜单互斥、启停一次 PATCH 和 revision、编辑抽屉。 |
| 质量检查 | `studio-automation` → `studio quality preparation summary reflects live inputs without changing the submitted query` | 摘要跟随范围、检查类型选择、原 POST 参数、结果切换。 |
| UT 执行详情 | `studio-automation` → `studio UT task overflow retains original delete confirmation and drawer focus on Escape` | 菜单关闭不关闭任务详情，原删除确认可取消。此项从执行记录打开，不覆盖 UT 报告建单全流程。 |
| 设置 | `studio-automation` → `studio settings directory and original configuration drawer remain usable without IntersectionObserver` | 设置目录定位、单一活动分区、CodeHub 抽屉打开/关闭；不覆盖每项保存。 |
| MR 队列与工作区 | `studio-mr` → `production MR queue retains pagination/filter/selection and always-expanded stages` | 队列分页、筛选、选择、Diff 文件及八阶段流程、记录展开、专注模式 Esc、返回后保留筛选和选择。 |
| MR 讨论、审核与合入 | `studio-mr` → `production MR discussion reply/resolve and review continue the original automatic merge workflow once` | 回复、解决讨论、人工审核后继续原自动合入流程并进入历史；保留 SHA 和 operationId，写入各一次，前端不额外发送合入请求。 |
| MR 审核后的列表状态 | `studio-mr` → `production MR list replaces one-click review with processing and moves automatic completion into history` | 列表一键审核不重复提交，显示继续处理，自动完成后移入历史。 |
| MR 直接合入入口 | `studio-mr` → `production MR already reviewed list and detail expose confirmed merge without opening processing records` | 已审核待合入记录在列表和详情顶部提供合入入口，原确认和 SHA 参数不变。 |
| MR 审核后状态读取失败 | `studio-mr` → `production MR acknowledged review stays non-repeatable when the following status read fails` | 保存成功后读取失败不会恢复旧待审状态或重复审核。 |
| MR 未确认结果 | `studio-mr` → `production MR unconfirmed review does not claim approval or automatically submit another write` | 未确认响应不宣称审核成功、不自动重放。 |
| MR 合入门禁 | `studio-mr` → `production MR direct merge remains disabled when current readiness, writes or SHA are unsafe` | 保留未通过门禁、待核对写入与旧 SHA 拦截。 |
| MR 失败草稿 | `studio-mr` → `production MR rejected discussion write keeps the draft and never replays it` | 503 后保留草稿，密度和专注模式重绘不重放写入。 |
| MR 批量合入 | `studio-mr` → `production MR batch merge stops after an uncertain response and preserves confirmation` | 明确确认后执行，首项响应不确定时停止剩余项，后续重绘不重试。 |
| MR 旧 SHA 防护 | `studio-mr` → `production MR remote SHA change prevents stale drafts from being submitted` | 远程 SHA 改变后旧草稿提交入口失效、解决操作禁用且不发送写入。 |
| UT 查询至选仓执行 | `studio-automation-flows` → `正式 UT 工作区从查询范围、报告、建单到选仓执行保留完整原始参数` | 范围变更要求刷新报告、版本和团队参数、建单标识、禁用空版本、选择仓库执行一次，以及任务详情和历史入口。 |
| UT 流转确认 | `studio-automation-flows` → `正式 UT 建单流转待确认时不启动，手动继续后只执行当前版本一次` | 流转未确认时禁止执行，手动继续的原始参数、仅当前版本执行，显示重绘不重放。 |
| UT 未知结果 | `studio-automation-flows` → `正式 UT 建单未知结果不自动重放，再次明确点击沿用同一请求标识` | 建单未知结果停止自动执行，显式再次点击沿用原 requestId。 |
| 服务知识维护 | `studio-automation-flows` → `正式服务知识保留来源、编辑取消、带 revision 保存、停用与启用` | 按仓库隔离知识、显示来源、取消编辑不写入、内容保存及启停携带当前 revision。 |
| 服务知识冲突 | `studio-automation-flows` → `正式服务知识遇到并发修改错误时保留原内容且不自动再次提交` | 409 保留原内容，视觉刷新不重试。 |
| MR 知识整理 | `studio-automation-flows` → `正式 MR 审核记录重新整理知识后可进入服务知识查看新增条目与来源` | 失败记录经用户重试后完成整理，只发送一次请求，可跳转知识页查看新增条目和来源。 |
| JSON | `studio-tools-portal` → `studio JSON entry preserves source tokens, original format/search/export hooks and reversible edits` | 重复键、超大整数、原文定位、格式化、搜索、撤销、无效输入、长输入降级；复制/下载入口存在。 |
| JSON 行为对照 | `studio-tools-parity` → `studio JSON transformations, keyboard search, clipboard and download match the original runtime` | 增强前后逐项对比格式化、压缩、转义、去转义、校验、键盘搜索；实际捕获复制内容和下载文件，保留大整数及中文。 |
| Binlog 命令与导出 | `studio-tools-parity` → `studio Binlog import, parse, exports and revision-checked delete work through isolated fixtures` | 导入实际 definition 契约、解析、自定义配置下载、JSON/Excel 导出及 revision、取消删除和明确删除后目录更新。 |
| Binlog 覆盖内置配置 | `studio-tools-parity` → `studio Binlog replacement requires explicit confirmation and deletion restores the builtin definition` | 覆盖前必须勾选确认，POST 携带 expectedRevision；删除覆盖配置后恢复原内置定义。 |
| Binlog 校验与冲突 | `studio-tools-parity` → `studio Binlog validation and stale revisions keep the dialog draft without automatically replaying writes` | 字段配置使用真实 parser 校验；并发注册产生 409 后保留草稿、禁用提交，无自动重试；重新校验并明确确认后才覆盖。 |
| Binlog | `studio-tools-portal` → `studio Binlog uses real command/parse contracts once and retains dropdown, Tag and message interactions` | 任意服务端命令、一次解析 POST 参数、下拉外部/Esc/焦点关闭、Tag/批量消息过滤、失败报文、输入收起/恢复、文件导入、导出按钮状态。 |
| Binlog 空值及失败 | `studio-tools-portal` → `studio command directory distinguishes empty API data from loading failure without fabricated commands or retry` | 空目录与 HTTP 503 分离展示，解析禁用，不注入命令、不自动重试。 |
| 应用中心 | `studio-tools-portal` → `studio application layouts preserve arbitrary server metadata and original opening/favorite actions; filter empties recover` | 卡片/列表元信息与 URL、原打开和编辑钩子、外部打开参数、收藏、筛选恢复、安全文本；未在此测试提交应用 CRUD。 |
| 应用创建与修改 | `studio-applications` → `production application create/edit uses original form and styled selects, retains all fields, and submits once while pending` | 通过真实表单及共享选择菜单创建/修改，保留全部八个字段与 revision；响应等待中重复点击只写入一次；取消不写入。 |
| 应用写入失败与删除 | `studio-applications` → `production application failed edit/delete preserve drafts and confirmation; explicit confirmed deletion uses current revision once` | 编辑冲突保留草稿，删除先确认，409/503 不自动重试；再次明确确认后才重发，删除使用当前 revision，成功后清理收藏。 |
| 应用 URL 与文本安全 | `studio-applications` → `production application form rejects unsafe URLs and remote unsafe entries never open or execute markup` | 表单拒绝 javascript/data URL、带凭据 URL 与空名称；不打开服务端不安全 URL，名称及说明按文本显示，深链不会创建不安全 iframe。 |
| 应用 iframe 生命周期 | `studio-applications` → `production embedded applications keep iframe identity during presentation/background refresh and return to their originating workspace` | 密度及后台重绘保留 iframe 节点，刷新只更新一次 src；sandbox/referrer/外链参数、目录与容器工作区返回、直接深链进入。未加载外部应用网络。 |
| 首页和常用工具目录 | `studio-tools-portal` → `studio home keeps card actions and presents a single consistent search result state` | 功能/工作空间搜索状态、Esc 清空、原首页卡片、工具收藏和键盘进入 JSON。 |

## 发布资产与 fixture 隔离

`studio-release.test.mjs` 包含以下三项：

- `Vite release HTML resolves its production runtime and includes every accepted workspace stylesheet`：发布 HTML 的资产引用有效，模块图包含正式运行时和增强模块，CSS 包含开发工具、应用、容器、自动化、共享菜单及导航规则。
- `Vite release excludes fixture modules, mock data hooks, test network interception and prototype CSP`：发布模块图不包含 `frontend/tests` 或 `frontend/prototypes`；产物不包含 fixture/mock 标记、测试网络覆盖或限制真实连接的原型 CSP。
- `compiled release boots the redesigned tools without replacing real browser transport functions`：执行编译后入口，JSON 新工作区出现，原 `fetch`、`EventSource`、`WebSocket`、`open` 对象未被替换，初始请求不写入。

`studio-api.js` 与 `studio-parser.js` 仅由测试 harness 引入。fixture 中的网络拦截、模拟数据、SSE 实现、下载数据及预览标记属于测试执行环境。正式入口没有测试模式开关。`prototype-runtime.js` 虽然沿用旧文件名，仍是正式 API 运行时，不能按文件名中的 `prototype` 一词将其排除。

## 既有测试与仍需区别的覆盖

- MR 的既有 `group-mr-entry.test.mjs`、`group-mr-actions.test.mjs`、`group-mr-workbench.test.mjs` 仍测试原始 `index.html`；新增 `studio-mr` 对表中主链、异常写入和 SHA 防护通过增强入口重新验证。不能据此认定所有旧 MR 测试都已带新增强层重跑。
- UT 建单、报告、流转及知识维护已有上表的增强入口验证；`quality-reports.test.mjs` 中其他边界场景、质量分页、定时计划创建等原页面测试，不能直接算作增强入口覆盖。
- `platform-applications.test.mjs` 继续覆盖原页面，新增 `studio-applications` 通过增强入口补齐 UI 驱动的 CRUD、写入错误、URL/XSS 和 iframe 生命周期；iframe 的外部站点连接和其响应安全策略仍需要目标环境验证。
- `home/overview`、`container/dashboard`、`automation/tools` 在正式入口的 20 路由比较中有控件与只读启动检查；该比较不代表这些页面的所有业务操作已逐项执行。
- JSDOM 不计算真实 CSS 布局。存在控件、样式规则或 `hidden` 属性的断言不证明窄屏排版、菜单位置、遮挡、滚动以及视觉观感正常，需要浏览器检查。
- 测试的 fetch/SSE 为本地 fixtures，不能证明真实 SSH、Kubernetes、Helm、Pi、CodeHub 或 Windows 启动脚本在目标网络正常。

## 运行

```sh
npm test --prefix frontend
```

只运行正式增强入口与发布隔离检查：

```sh
npm --prefix frontend run test:studio
node --test frontend/tests/studio-release.test.mjs
```

`studio-release` 已包含在两个测试集合中；单独命令适合检查发布资产。

以正式生产构建和测试 fixture 进行本地浏览器验证：

```sh
npm --prefix frontend run preview:fixtures
```

该命令先生成 `frontend/dist`，再在 `http://127.0.0.1:5175/` 注入测试专用 fixture。预览脚本与 fixture 不进入正式产物。页面上带有测试预览标记，真实请求由测试环境隔离。

启动正式开发入口：

```sh
npm --prefix frontend run dev
```

正式入口不注入模拟响应；后端连接仍取决于开发环境配置。

## V0.2.187 浏览器复核

使用正式生产资产和隔离 fixture 在浏览器中复核（截图保存在本地 `.tmp/style-review/`）：

- 390、650、700、701、768、900、1024、1280px 下，顶栏控件均未超出顶栏；650–700px 使用抽屉导航，正文恢复全宽。
- 390px 的 MR 目录收起后从 160px 缩为 42px，代码区从 194px 扩为 312px，不再留下 120px 空栏。
- 窄屏容器环境卡片按实际字段显示“业务面 / 管理面”，不再误标“系统架构”。
- MR 详情一键审核后显示“合入处理中”，随后自动刷新为“已合入”；保持完整八阶段流程。没有对真实 MR 发起写入。

前端本轮 249 项通过，类型检查与生产构建通过。桌面与窄屏还抽查了首页、容器页面、自动化页面、工具和应用中心；表格内部的局部横向滚动不等同于整页溢出。
