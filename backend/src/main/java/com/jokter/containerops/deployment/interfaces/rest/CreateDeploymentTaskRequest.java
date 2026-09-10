package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.CreateDeploymentTaskCommand;
import com.jokter.containerops.deployment.domain.model.DeploymentMode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record CreateDeploymentTaskRequest(
        @NotNull DeploymentMode mode,
        @NotNull Long artifactId,
        @NotNull Long environmentId,
        @NotBlank String namespace,
        @NotEmpty List<@NotBlank String> services
) {
    CreateDeploymentTaskCommand toCommand() {
        return new CreateDeploymentTaskCommand(mode, artifactId, environmentId, namespace, services);
    }
}
