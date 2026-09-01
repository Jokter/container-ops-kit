package com.jokter.containerops.containerresource.domain.model;

public record ResourceGroupSummary(ResourceGroupType type, String name, int resourceCount) {
}
