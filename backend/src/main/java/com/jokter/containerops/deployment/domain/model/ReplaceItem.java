package com.jokter.containerops.deployment.domain.model;

public record ReplaceItem(String location, String key, String oldValue, String newValue) {
}
