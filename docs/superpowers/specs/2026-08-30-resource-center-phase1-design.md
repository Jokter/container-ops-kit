# 资源中心第一阶段设计

> 状态：已确认，准备进入开发计划
> 范围：环境配置持久化与真实 SSH 测试
> 运行方式：单机、单用户优先

## 1. 目标

资源中心第一阶段支持构建环境和容器环境的配置持久化，并通过账号密码执行真实 SSH 连接测试。页面保留现有原型的主要视觉与交互结构。

本阶段不实现登录、权限、多用户协作、任务进度、测试历史、命令执行、跳板机和密钥认证。

## 2. 技术架构

采用前后端分离开发、单体应用交付：

- 前端：Vue 3、TypeScript、Vite、Pinia、Element Plus
- 后端：Java Spring Boot、Maven、Spring Data JPA
- 数据库：H2 文件数据库
- 数据迁移：Flyway
- SSH：成熟 Java SSH 客户端，仅支持账号密码
- 交付：Vue 构建产物由 Spring Boot 提供静态资源

开发时前端和后端独立运行；交付时启动一个 Spring Boot 应用即可。

## 3. 存储

H2 文件数据库路径为应用目录下的 `data/resource-center`，服务重启后数据保留。

数据库包含：

### release_version

保存固定发布版本：

- R27C10
- R27C00

第一阶段不提供发布版本增删改。

### environment

字段包括：

- id
- release_version_id
- type：BUILD 或 CONTAINER
- name
- host
- ssh_port
- password：明文保存
- work_directory
- architecture
- connection_status：UNTESTED、REACHABLE、FAILED
- last_tested_at
- last_test_latency_ms
- last_test_error
- created_at
- updated_at
- version

容器环境额外保存 MAE 和 OSMU 的地址、账号、密码。

不建立测试历史表。每次测试只覆盖环境的最后一次测试结果。

修改 host、ssh_port 或 password 后，connection_status 自动重置为 UNTESTED。

## 4. SSH 规则

- 构建环境固定 SSH 用户名：huawei
- 容器环境固定 SSH 用户名：sopuser
- 默认端口：22
- 仅验证 TCP 连接、SSH 握手和账号密码认证
- 不执行远端命令
- 不验证工作目录、MAE 或 OSMU 服务
- 第一阶段接受服务器主机密钥，不维护 known_hosts
- 连接与认证设置超时，单次测试最长约 10 秒

失败结果归类为地址无法解析、连接超时、端口拒绝、账号或密码错误、SSH 协议错误和其他连接异常。

## 5. REST API

- GET /api/release-versions
- GET /api/environments
- GET /api/environments/{id}
- POST /api/environments
- PUT /api/environments/{id}
- DELETE /api/environments/{id}
- POST /api/connection-tests/preview
- POST /api/environments/{id}/connection-test
- POST /api/environments/connection-tests/batch

保存前测试只返回结果，不写入环境；已保存环境测试和批量测试更新最后一次测试结果。

接口使用标准 HTTP 状态码：

- 400：参数校验失败
- 404：资源不存在
- 409：版本冲突
- 500：服务内部错误

## 6. 前端

资源中心拆分为 API、类型、Pinia store、页面和组件：

```
frontend/src/
├── api/
├── components/resource-center/
├── stores/
├── types/
└── views/
```

支持按版本、环境类型、名称、地址和连接状态筛选。

“更多”菜单只保留复制 SSH 命令和删除环境。密码使用普通文本输入框，允许直接查看和编辑。

测试期间只禁用当前按钮并显示加载状态，不展示进度和历史。

## 7. 部署

第一阶段使用本机文件存储，不依赖 Docker PostgreSQL。应用目录需要具备 data 目录写权限。后续迁移 PostgreSQL 时保留 JPA 和领域模块结构，仅替换数据库驱动、连接配置和部署文件。

## 8. 验收标准

- Spring Boot 可独立启动并自动创建 H2 文件数据库
- 环境配置在服务重启后仍然存在
- 可以新建、查看、编辑、删除构建环境和容器环境
- 发布版本只显示 R27C10、R27C00
- 可以对保存前配置执行真实 SSH 测试
- 可以对单个已保存环境执行真实 SSH 测试
- 可以批量测试全部或筛选后的环境
- 状态只有未测试、可连接、连接失败
- 修改 SSH 配置后状态重置为未测试
- 不保留测试历史和测试进度
- 前端、后端、数据库和真实 SSH 联调通过
