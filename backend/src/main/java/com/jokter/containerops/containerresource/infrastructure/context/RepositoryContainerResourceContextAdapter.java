package com.jokter.containerops.containerresource.infrastructure.context;

import com.jokter.containerops.containerresource.application.ContainerResourceContextPort;
import com.jokter.containerops.containerresource.application.ContainerResourceTarget;
import com.jokter.containerops.environment.application.EnvironmentNotFoundException;
import com.jokter.containerops.environment.domain.model.Environment;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import com.jokter.containerops.environment.domain.model.SshUser;
import com.jokter.containerops.environment.domain.repository.EnvironmentRepository;
import org.springframework.stereotype.Component;

@Component
class RepositoryContainerResourceContextAdapter implements ContainerResourceContextPort {
    private final EnvironmentRepository environments;

    RepositoryContainerResourceContextAdapter(EnvironmentRepository environments) {
        this.environments = environments;
    }

    @Override
    public ContainerResourceTarget target(Long environmentId) {
        Environment environment = environments.findById(environmentId)
                .orElseThrow(() -> new EnvironmentNotFoundException("容器环境不存在"));
        if (environment.getType() != EnvironmentType.CONTAINER) {
            throw new IllegalArgumentException("服务资源只能选择容器环境");
        }
        return new ContainerResourceTarget(
                environment.getId(),
                environment.getName(),
                environment.getHost(),
                environment.getSshPort(),
                SshUser.ROOT.username(),
                environment.sshPassword(SshUser.ROOT)
        );
    }
}
