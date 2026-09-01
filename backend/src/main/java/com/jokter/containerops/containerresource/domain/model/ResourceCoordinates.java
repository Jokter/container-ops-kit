package com.jokter.containerops.containerresource.domain.model;

public record ResourceCoordinates(
        String group,
        String version,
        String resource,
        String namespace,
        String name
) {
}
