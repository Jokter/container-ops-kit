package com.jokter.containerops.environment.domain.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class EnvironmentTest {
    private final ReleaseVersion releaseVersion = new ReleaseVersion(1L, "R27C10", "R27C10", 1);

    @Test
    void containerEnvironmentProvidesPasswordsForBothFixedUsers() {
        Environment environment = Environment.create(
                releaseVersion,
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

        assertThat(environment.sshPassword(SshUser.SOPUSER)).isEqualTo("sop-password");
        assertThat(environment.sshPassword(SshUser.ROOT)).isEqualTo("root-password");
        assertThat(environment.defaultSshUser()).isEqualTo(SshUser.SOPUSER);
    }

    @Test
    void buildEnvironmentUsesHuaweiAsItsOnlyFixedUser() {
        Environment environment = Environment.create(
                releaseVersion,
                EnvironmentType.BUILD,
                "构建环境",
                "10.0.0.2",
                22,
                "build-password",
                null,
                "/opt/build",
                "AARCH64",
                null,
                null,
                null,
                null,
                null,
                null
        );

        assertThat(environment.sshPassword(SshUser.HUAWEI)).isEqualTo("build-password");
        assertThat(environment.defaultSshUser()).isEqualTo(SshUser.HUAWEI);
    }
}
