package com.jokter.containerops.containerresource.domain.service;

import com.jokter.containerops.containerresource.domain.model.ResourceGroupSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;

import java.util.List;

public record ServiceResourceInventory(
        List<ServiceSummary> services,
        List<ResourceGroupSummary> groups
) {
}
