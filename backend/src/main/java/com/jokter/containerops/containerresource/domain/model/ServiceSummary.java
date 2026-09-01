package com.jokter.containerops.containerresource.domain.model;

public record ServiceSummary(
        String key,
        String name,
        ServiceSource source,
        String status,
        int resourceCount
) {
}
