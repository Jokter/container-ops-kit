package com.jokter.containerops.containerresource.domain.model;

public record ResourceChangeResult(ResourceCoordinates coordinates, String resourceVersion, String yaml) {
}
