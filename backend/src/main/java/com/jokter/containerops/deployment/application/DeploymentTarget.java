package com.jokter.containerops.deployment.application;

public record DeploymentTarget(Long environmentId, String environmentName, RemoteEndpoint endpoint) {
}
