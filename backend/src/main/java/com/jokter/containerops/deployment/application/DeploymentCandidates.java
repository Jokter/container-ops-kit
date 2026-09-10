package com.jokter.containerops.deployment.application;

import java.util.List;

public record DeploymentCandidates(String module, List<DeploymentWorkloadCandidate> workloads, List<String> namespaces) {
}
