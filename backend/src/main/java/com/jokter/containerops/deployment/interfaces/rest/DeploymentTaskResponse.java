package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.domain.model.DeploymentTask;
import com.jokter.containerops.deployment.domain.model.DeploymentMode;
import com.jokter.containerops.deployment.domain.model.DeploymentTaskStatus;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

public record DeploymentTaskResponse(
        String id,
        DeploymentMode mode,
        DeploymentTaskStatus status,
        Long artifactId,
        Long environmentId,
        String module,
        String namespace,
        long revision,
        Instant createdAt,
        Instant startedAt,
        Instant finishedAt,
        Map<String, PreparedServiceResponse> services
) {
    static DeploymentTaskResponse from(DeploymentTask source) {
        Map<String, PreparedServiceResponse> services = new LinkedHashMap<>();
        source.services().forEach((name, value) -> services.put(name, PreparedServiceResponse.from(value)));
        return new DeploymentTaskResponse(source.id(), source.mode(), source.status(), source.artifactId(), source.environmentId(), source.module(), source.namespace(), source.revision(), source.createdAt(), source.startedAt(), source.finishedAt(), services);
    }
}
