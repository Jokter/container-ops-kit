# 快速部署

> 状态：已实现

## 实现索引

- 领域语言与稳定边界：[领域模型](../../domain-model.md)
- 运行数据来源、执行边界与接口：[部署工作区](../../deployment-workspace.md)
- 任务状态与约束：`backend/src/main/java/com/jokter/containerops/deployment/domain/model/DeploymentTask.java`
- 两种部署方式：`backend/src/main/java/com/jokter/containerops/deployment/domain/model/DeploymentMode.java`
- 应用用例入口：`backend/src/main/java/com/jokter/containerops/deployment/application/DeploymentApplicationService.java`
- 内部工作流：`backend/src/main/java/com/jokter/containerops/deployment/application/DeploymentWorkflow.java`
- 页面交互：`frontend/src/prototype-runtime.js`

## 验证索引

- 领域状态迁移：`backend/src/test/java/com/jokter/containerops/deployment/domain/model/DeploymentTaskTest.java`
- 应用工作流：`backend/src/test/java/com/jokter/containerops/deployment/application/DeploymentApplicationServiceTest.java`
- 接口与事件恢复：`backend/src/test/java/com/jokter/containerops/deployment/interfaces/rest/DeploymentEventsEndpointTest.java`
