package com.jokter.containerops.deployment.domain.service;

import java.util.Map;

public record EnvironmentSnapshot(
        Map<String, String> versions,
        Map<String, String> placeholderVersions,
        String jars,
        Map<String, String> globalOverrides
) {
}
