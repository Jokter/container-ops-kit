package com.jokter.containerops.deployment.application;

public interface DeploymentContextPort {
    DeploymentArtifact artifact(Long artifactId);

    DeploymentTarget target(Long environmentId);
}
