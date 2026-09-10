package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.DeploymentMode;

import java.util.List;

public record CreateDeploymentTaskCommand(DeploymentMode mode, Long artifactId, Long environmentId, String namespace, List<String> services) {
}
