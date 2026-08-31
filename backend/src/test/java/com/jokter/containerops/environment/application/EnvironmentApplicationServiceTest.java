package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.ConnectionStatus;
import com.jokter.containerops.environment.domain.model.Environment;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import com.jokter.containerops.environment.domain.model.ReleaseVersion;
import com.jokter.containerops.environment.domain.model.SshUser;
import com.jokter.containerops.environment.domain.repository.EnvironmentRepository;
import com.jokter.containerops.environment.domain.repository.ReleaseVersionRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EnvironmentApplicationServiceTest {
    @Test
    void testsSavedContainerEnvironmentWithSelectedRootAccount() {
        EnvironmentRepository environments = mock(EnvironmentRepository.class);
        ReleaseVersionRepository versions = mock(ReleaseVersionRepository.class);
        SshConnectionPort ssh = mock(SshConnectionPort.class);
        Environment environment = Environment.create(
                new ReleaseVersion(1L, "R27C10", "R27C10", 1),
                EnvironmentType.CONTAINER,
                "容器环境",
                "10.0.0.1",
                22,
                "sop-password",
                "root-password",
                "/opt/runtime",
                "X86_64",
                null,
                null,
                null,
                null,
                null,
                null
        );
        when(environments.findById(1L)).thenReturn(Optional.of(environment));
        when(ssh.test(any())).thenReturn(new ConnectionTestResult(ConnectionStatus.REACHABLE, 12L, null));
        EnvironmentApplicationService service = new EnvironmentApplicationService(environments, versions, ssh);

        service.test(1L, SshUser.ROOT);

        verify(ssh).test(new ConnectionTestCommand(SshUser.ROOT, "10.0.0.1", 22, "root-password"));
        verify(environments).save(environment);
    }
}
