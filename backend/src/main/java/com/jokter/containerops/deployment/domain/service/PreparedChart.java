package com.jokter.containerops.deployment.domain.service;

import com.jokter.containerops.deployment.domain.model.ReplaceItem;

import java.util.List;
import java.util.Map;
import java.util.Set;

public record PreparedChart(
        String values,
        String chart,
        Map<String, String> templates,
        List<ReplaceItem> replaceItems,
        Set<String> unresolvedImages,
        List<String> errors
) {
}
