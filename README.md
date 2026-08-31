# Container Ops Kit

资源中心第一阶段包含环境配置持久化和真实 SSH 账号密码测试。

## 启动后端

需要 Java 17 和 Maven：

```bash
mvn -pl backend spring-boot:run
```

H2 文件数据库默认保存在应用目录的 `data/resource-center`。

## 启动前端

需要 Node.js：

```bash
cd frontend
npm install
npm run dev
```

前端开发服务默认通过 Vite 代理访问 `http://localhost:8080`。

SSH 用户名由环境类型固定派生：

- 构建环境：huawei
- 容器环境：sopuser

第一阶段只支持账号密码，不执行远端命令，不保留测试历史。
