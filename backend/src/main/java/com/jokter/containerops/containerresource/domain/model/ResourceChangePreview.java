package com.jokter.containerops.containerresource.domain.model;

import java.util.List;

public record ResourceChangePreview(boolean valid, String diff, String observedResourceVersion, List<String> warnings) {
    public ResourceChangePreview {
        warnings = List.copyOf(warnings);
    }
}
