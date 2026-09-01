package com.jokter.containerops.deployment.application;

import java.util.List;

public record CreateDeploymentPreparationCommand(Long artifactId, Long environmentId, String namespace, List<String> services) {
}
