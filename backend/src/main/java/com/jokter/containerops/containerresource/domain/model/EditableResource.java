package com.jokter.containerops.containerresource.domain.model;

public record EditableResource(
        ResourceCoordinates coordinates,
        String yaml,
        String resourceVersion,
        boolean managedByHelm
) {
}
