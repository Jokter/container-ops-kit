package com.jokter.containerops.deployment.application;

public record DeploymentArtifact(
        Long id,
        String module,
        String chartsPath,
        RemoteEndpoint buildEndpoint,
        String remoteModuleRoot,
        String remoteChartsRoot
) {
}
