package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.EnvironmentType;

public record EnvironmentCommand(
        Long releaseVersionId,
        EnvironmentType type,
        String name,
        String host,
        Integer sshPort,
        String password,
        String rootPassword,
        String workDirectory,
        String architecture,
        String businessPlaneUrl,
        String businessPlaneUser,
        String businessPlanePassword,
        String managementPlaneUrl,
        String managementPlaneUser,
        String managementPlanePassword,
        Long version
) {
}
