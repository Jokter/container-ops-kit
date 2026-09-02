package com.jokter.containerops.deployment.application;

import java.util.Map;

record HelmEnvironmentValues(Map<String, String> placeholderVersions, Map<String, String> globalOverrides) {
}
