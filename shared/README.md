# 共享接口约定

这里只放跨前后端的数据结构和运行时校验，不依赖数据库、文件系统或后端实现。

当前 `contracts.ts` 覆盖通用 TypeScript 平台任务。构建、部署和 Auto-UT 使用各自业务状态机与任务 ID，并由对应 TypeScript 模块持久化。
