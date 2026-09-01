package com.jokter.containerops.deployment.application;

import java.util.List;

public record DeploymentCandidates(String module, List<String> services, List<String> namespaces) {
}
