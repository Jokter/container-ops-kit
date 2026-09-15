# 项目开发约束

- 当前是 TypeScript 渐进迁移第一阶段。先阅读 `docs/typescript-migration.md`，不能把代理承接的 Java 功能描述为已经完成迁移。
- `index.html` 是现有页面源；迁移后端不顺便重新设计页面。
- 保留旧 API 请求/响应/状态码、multipart 和 SSE 语义。对真实部署、删除、MR 提交等操作不得做自动重试。
- 不删除或覆盖 H2 数据；新 SQLite 仅用于原生平台任务。
- TypeScript 使用 strict、运行时输入校验，禁止用 any 或双重类型断言掩盖接口错误。
- `shared` 不导入后端，业务模块不依赖别的模块基础设施实现。
- 不增加接受任意命令的 HTTP 端点。日志不得包含账号密码、请求体或凭据。
- 提交前运行根目录 `npm run check` 和前端已有测试/构建；对未运行的 Windows、SSH、Pi、CodeHub 集成明确说明。
