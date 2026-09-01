package com.jokter.containerops.containerresource.domain.model;

import java.util.Set;

public record ObservedResource(
        String group,
        String version,
        String resource,
        String name,
        boolean clusterScoped,
        Set<String> serviceKeys
) {
    public ObservedResource {
        serviceKeys = Set.copyOf(serviceKeys);
    }
}
