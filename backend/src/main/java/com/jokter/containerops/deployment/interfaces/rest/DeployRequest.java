package com.jokter.containerops.deployment.interfaces.rest;

import jakarta.validation.constraints.NotBlank;

public record DeployRequest(long revision, @NotBlank String confirmationToken) {
}
