# Container Ops Kit

Container Ops Kit 包含环境资源管理、真实 SSH 连接测试、远程构建和部署准备工作区。

## 一键启动

Windows 双击根目录的 `start.bat`。脚本会检查 Java 21、Maven、Node.js 和 npm，首次运行自动安装前端依赖，随后分别启动后端和前端并打开浏览器。

## 前端页面源

根目录的 `index.html` 是页面样式和交互的唯一来源，文件保持不变。Vite 启动时直接加载该页面，并注入 `frontend/src/prototype-runtime.js`，将资源中心的模拟数据和操作替换为后端 API。

## 后端架构

资源中心位于 `com.jokter.containerops.environment` 领域模块：

- `domain`：领域模型和仓储接口
- `application`：用例、命令和 SSH 端口
- `infrastructure`：JPA 与 Apache SSHD 适配
- `interfaces`：REST 请求、响应和控制器

构建工作区位于 `com.jokter.containerops.build`，同样按 `domain / application / infrastructure / interfaces` 组织。构建领域通过端口读取构建环境并执行远程命令，不直接依赖资源中心的 REST 或 JPA 模型。

构建规则和 API 索引见 [构建工作区](docs/build-workspace.md)。

部署工作区位于 `com.jokter.containerops.deployment`，从成功构建产物读取 Chart，并从容器环境 OM 节点采集真实版本、JAR、镜像和环境 global 配置。部署规则和破坏性操作边界见 [部署工作区](docs/deployment-workspace.md)。

## 手动启动后端

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
