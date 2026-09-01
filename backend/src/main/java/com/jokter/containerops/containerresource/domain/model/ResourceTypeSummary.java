package com.jokter.containerops.containerresource.domain.model;

import java.util.Collections;
import java.util.Set;
import java.util.TreeSet;

public record ResourceTypeSummary(
        String group,
        String version,
        String resource,
        String kind,
        boolean namespaced,
        Set<String> verbs,
        boolean schemaAvailable,
        boolean custom
) {
    public ResourceTypeSummary {
        verbs = Collections.unmodifiableSet(new TreeSet<>(verbs));
    }
}
