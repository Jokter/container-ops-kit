package com.jokter.containerops.deployment.application;

import java.util.List;
import java.util.Map;

record DeploymentEnvironment(
        String architecture,
        Map<String, String> placeholderVersions,
        Map<String, String> globalOverrides,
        List<RuntimeContainer> containers
) {
}
