# 运维平台

运维平台以容器化、虚拟化和自动化工具作为顶层边界；当前提供环境资源管理、真实 SSH 连接测试、远程构建、部署和 Auto-UT 工作区。

## 一键启动

Windows 双击根目录的 `start.bat`。当前为 TypeScript 渐进迁移第一阶段，需要 Node.js 24.15+（24.x）、npm、Java 21 和 Maven。脚本通过锁文件安装依赖并编译 TypeScript，然后启动 TypeScript 入口（8080）、Java 兼容后端（8081）和前端（5173）。

**本阶段不是全部 Java 功能的重写。** 原构建、部署、资源中心、Auto-UT 修复仍由 Java 执行，TypeScript 负责统一入口、原生目录浏览和新的持久化只读任务。迁移边界、数据位置、验证和回退方式见 [TypeScript 迁移说明](docs/typescript-migration.md)。

保留原 Java 启动方式：停止上述三个进程后运行 `start-java.bat`。不要同时运行两套启动方式。

## 前端页面源

根目录的 `index.html` 是页面样式和交互的唯一来源，文件保持不变。Vite 启动时直接加载该页面，并注入 `frontend/src/prototype-runtime.js`，将资源中心的模拟数据和操作替换为后端 API。

## 后端架构

新增 `backend-ts/src/modules` 按业务组织原生能力，`backend-ts/src/platform` 提供 SQLite 任务事件日志与独立 Worker；`shared` 只承载数据约定。尚未迁移的 `/api` 请求通过流式兼容层交给 Java，不改变原请求体和数据存储。

资源中心位于 `com.jokter.containerops.environment` 领域模块：

- `domain`：领域模型和仓储接口
- `application`：用例、命令和 SSH 端口
- `infrastructure`：JPA 与 Apache SSHD 适配
- `interfaces`：REST 请求、响应和控制器

构建工作区位于 `com.jokter.containerops.build`，同样按 `domain / application / infrastructure / interfaces` 组织。构建领域通过端口读取构建环境并执行远程命令，不直接依赖资源中心的 REST 或 JPA 模型。

构建规则和 API 索引见 [构建工作区](docs/build-workspace.md)。

部署工作区位于 `com.jokter.containerops.deployment`，从成功构建产物读取 Chart，并从容器环境 OM 节点采集真实版本、JAR、镜像和环境 global 配置。部署规则和破坏性操作边界见 [部署工作区](docs/deployment-workspace.md)。

Auto-UT 工作区位于 `com.jokter.containerops.autout`，从用户上传的 Grafana UT CSV 创建本机修复任务。运行边界和 API 索引见 [Auto-UT 工作区](docs/auto-ut-workspace.md)。

## 手动启动后端（迁移模式）

在仓库根目录安装并编译：

```bash
npm ci
npm run build
```

分别打开两个终端，均从仓库根目录启动：

```bash
mvn -pl backend spring-boot:run -Dspring-boot.run.arguments="--server.port=8081 --server.address=127.0.0.1"
```

```bash
npm start
```

`/api/health` 检查整个兼容模式是否就绪；`/api/platform/health` 只检查 TypeScript 进程。

## 手动启动后端（原 Java 模式）

需要 JDK 21 和 Maven：

```bash
mvn -pl backend spring-boot:run
```

H2 文件数据库默认保存在应用目录的 `data/resource-center`。

## 手动启动前端

需要 Node.js：

```bash
cd frontend
npm install
npm run dev
```

前端通过 Vite 代理访问 `http://localhost:8080`。

SSH 用户名由环境类型固定派生：

- 构建环境：huawei
- 容器环境：sopuser、root

SSH 连接测试、构建和部署均使用账号密码。连接测试不保留历史；构建状态和部署准备不持久化，服务重启后清空。应用及部署实时日志写入 `logs/container-ops-kit.log`，滚动历史日志保存在同一目录。
