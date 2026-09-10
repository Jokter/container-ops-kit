package com.jokter.containerops.deployment.application;

public record DeploymentWorkloadCandidate(String name, WorkloadKind kind, boolean deployable) {
}
