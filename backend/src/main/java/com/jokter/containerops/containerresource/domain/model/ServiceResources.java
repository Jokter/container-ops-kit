package com.jokter.containerops.containerresource.domain.model;

import java.util.List;

public record ServiceResources(String serviceKey, String serviceName, List<ResourceSummary> resources) {
    public ServiceResources {
        resources = List.copyOf(resources);
    }
}
