package com.jokter.containerops.containerresource.interfaces.rest;

import com.jokter.containerops.containerresource.domain.model.ResourceGroupSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceResourceWorkspace;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;

import java.util.List;

public record ContainerResourceServicesResponse(
        Long environmentId,
        String environmentName,
        String namespace,
        List<ServiceSummary> services,
        List<ResourceGroupSummary> groups
) {
    static ContainerResourceServicesResponse from(ServiceResourceWorkspace workspace) {
        return new ContainerResourceServicesResponse(
                workspace.environmentId(),
                workspace.environmentName(),
                workspace.namespace(),
                workspace.services(),
                workspace.groups()
        );
    }
}
