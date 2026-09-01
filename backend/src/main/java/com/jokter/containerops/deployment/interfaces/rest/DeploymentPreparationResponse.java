package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;

import java.util.LinkedHashMap;
import java.util.Map;

public record DeploymentPreparationResponse(
        String id,
        Long artifactId,
        Long environmentId,
        String module,
        String namespace,
        long revision,
        Map<String, PreparedServiceResponse> services
) {
    static DeploymentPreparationResponse from(DeploymentPreparation source) {
        Map<String, PreparedServiceResponse> services = new LinkedHashMap<>();
        source.services().forEach((name, value) -> services.put(name, PreparedServiceResponse.from(value)));
        return new DeploymentPreparationResponse(source.id(), source.artifactId(), source.environmentId(), source.module(), source.namespace(), source.revision(), services);
    }
}
