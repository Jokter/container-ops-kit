package com.jokter.containerops.containerresource.domain.model;

public record ResourceSummary(
        String group,
        String version,
        String resource,
        String kind,
        String name,
        String category,
        String status,
        boolean custom,
        boolean editable
) {
}
