package com.jokter.containerops.deployment.interfaces.rest;

import jakarta.validation.constraints.Positive;

public record ExecuteDeploymentRequest(@Positive long expectedRevision) {
}
