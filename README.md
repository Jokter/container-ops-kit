# Container Ops Kit

资源中心第一阶段包含环境配置持久化和真实 SSH 账号密码测试。

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
- 容器环境：sopuser

第一阶段只支持账号密码，不执行远端命令，不保留测试历史。
