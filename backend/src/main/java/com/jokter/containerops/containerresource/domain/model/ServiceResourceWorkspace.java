package com.jokter.containerops.containerresource.domain.model;

import java.util.List;

public record ServiceResourceWorkspace(
        Long environmentId,
        String environmentName,
        String namespace,
        List<ServiceSummary> services,
        List<ResourceGroupSummary> groups
) {
}
