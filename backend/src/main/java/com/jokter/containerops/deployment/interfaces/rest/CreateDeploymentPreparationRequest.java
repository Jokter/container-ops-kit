package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.CreateDeploymentPreparationCommand;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record CreateDeploymentPreparationRequest(
        @NotNull Long artifactId,
        @NotNull Long environmentId,
        @NotBlank String namespace,
        @NotEmpty List<@NotBlank String> services
) {
    CreateDeploymentPreparationCommand toCommand() {
        return new CreateDeploymentPreparationCommand(artifactId, environmentId, namespace, services);
    }
}
