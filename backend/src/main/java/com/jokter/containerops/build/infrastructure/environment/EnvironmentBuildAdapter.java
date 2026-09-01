package com.jokter.containerops.build.infrastructure.environment;

import com.jokter.containerops.build.application.BuildEnvironment;
import com.jokter.containerops.build.application.BuildEnvironmentPort;
import com.jokter.containerops.environment.application.EnvironmentNotFoundException;
import com.jokter.containerops.environment.domain.model.Environment;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import com.jokter.containerops.environment.domain.model.SshUser;
import com.jokter.containerops.environment.domain.repository.EnvironmentRepository;
import org.springframework.stereotype.Component;

@Component
class EnvironmentBuildAdapter implements BuildEnvironmentPort {
    private final EnvironmentRepository environments;

    EnvironmentBuildAdapter(EnvironmentRepository environments) {
        this.environments = environments;
    }

    @Override
    public BuildEnvironment get(Long id) {
        Environment environment = environments.findById(id)
                .orElseThrow(() -> new EnvironmentNotFoundException("构建环境不存在"));
        if (environment.getType() != EnvironmentType.BUILD) {
            throw new IllegalArgumentException("构建任务只能选择构建环境");
        }
        return new BuildEnvironment(
                environment.getId(),
                environment.getName(),
                environment.getHost(),
                environment.getSshPort(),
                SshUser.HUAWEI.username(),
                environment.sshPassword(SshUser.HUAWEI),
                environment.getWorkDirectory()
        );
    }
}
