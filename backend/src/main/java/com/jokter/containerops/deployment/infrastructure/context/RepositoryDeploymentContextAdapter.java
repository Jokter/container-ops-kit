package com.jokter.containerops.deployment.infrastructure.context;

import com.jokter.containerops.build.application.BuildModuleCatalog;
import com.jokter.containerops.build.domain.model.BuildArtifact;
import com.jokter.containerops.build.domain.model.BuildArtifactRepository;
import com.jokter.containerops.build.domain.model.BuildModule;
import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import com.jokter.containerops.deployment.application.DeploymentArtifact;
import com.jokter.containerops.deployment.application.DeploymentContextPort;
import com.jokter.containerops.deployment.application.DeploymentNotFoundException;
import com.jokter.containerops.deployment.application.DeploymentTarget;
import com.jokter.containerops.deployment.application.RemoteEndpoint;
import com.jokter.containerops.environment.domain.model.Environment;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import com.jokter.containerops.environment.domain.model.SshUser;
import com.jokter.containerops.environment.domain.repository.EnvironmentRepository;
import org.springframework.stereotype.Component;

@Component
class RepositoryDeploymentContextAdapter implements DeploymentContextPort {
    private final BuildArtifactRepository artifacts;
    private final BuildModuleCatalog modules;
    private final BuildTaskRepository tasks;
    private final EnvironmentRepository environments;

    RepositoryDeploymentContextAdapter(BuildArtifactRepository artifacts, BuildModuleCatalog modules, BuildTaskRepository tasks, EnvironmentRepository environments) {
        this.artifacts = artifacts;
        this.modules = modules;
        this.tasks = tasks;
        this.environments = environments;
    }

    @Override
    public DeploymentArtifact artifact(Long artifactId) {
        BuildArtifact artifact = artifacts.findById(artifactId)
                .orElseThrow(() -> new DeploymentNotFoundException("构建产物不存在"));
        tasks.findById(artifact.buildTaskId())
                .filter(task -> task.mode() == BuildMode.SINGLE && task.status() == BuildStatus.SUCCEEDED)
                .orElseThrow(() -> new DeploymentNotFoundException("关联的成功单分支构建任务不存在"));
        Environment environment = environments.findById(artifact.buildEnvironmentId())
                .orElseThrow(() -> new DeploymentNotFoundException("构建环境不存在"));
        BuildModule module = modules.get(artifact.module());
        return new DeploymentArtifact(
                artifact.id(),
                artifact.module(),
                module.chartsPath(),
                endpoint(environment, SshUser.HUAWEI),
                artifact.remoteModuleRoot(),
                artifact.remoteChartsRoot()
        );
    }

    @Override
    public DeploymentTarget target(Long environmentId) {
        Environment environment = environments.findById(environmentId)
                .orElseThrow(() -> new DeploymentNotFoundException("容器环境不存在"));
        if (environment.getType() != EnvironmentType.CONTAINER) {
            throw new IllegalArgumentException("部署只能选择容器环境");
        }
        return new DeploymentTarget(environment.getId(), environment.getName(), endpoint(environment, SshUser.ROOT));
    }

    private RemoteEndpoint endpoint(Environment environment, SshUser user) {
        return new RemoteEndpoint(environment.getHost(), environment.getSshPort(), user.username(), environment.sshPassword(user));
    }
}
