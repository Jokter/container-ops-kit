package com.jokter.containerops.containerresource.domain.service;

import com.jokter.containerops.containerresource.domain.model.ObservedResource;
import com.jokter.containerops.containerresource.domain.model.ResourceGroupSummary;
import com.jokter.containerops.containerresource.domain.model.ResourceGroupType;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ServiceOwnershipResolver {
    public ServiceResourceInventory resolve(List<ServiceSummary> services, List<ObservedResource> resources) {
        Map<String, Integer> counts = new HashMap<>();
        services.forEach(service -> counts.put(service.key(), 0));
        int shared = 0;
        int unassigned = 0;
        int cluster = 0;
        for (ObservedResource resource : resources) {
            if (resource.clusterScoped()) {
                cluster++;
            } else if (resource.serviceKeys().size() > 1) {
                shared++;
            } else if (resource.serviceKeys().isEmpty()) {
                unassigned++;
            } else {
                String key = resource.serviceKeys().iterator().next();
                counts.computeIfPresent(key, (ignored, count) -> count + 1);
            }
        }
        List<ServiceSummary> resolvedServices = services.stream()
                .map(service -> new ServiceSummary(
                        service.key(),
                        service.name(),
                        service.source(),
                        service.status(),
                        counts.getOrDefault(service.key(), 0)
                ))
                .sorted(Comparator.comparing(ServiceSummary::name))
                .toList();
        List<ResourceGroupSummary> groups = new ArrayList<>();
        groups.add(new ResourceGroupSummary(ResourceGroupType.SHARED, "公共资源", shared));
        groups.add(new ResourceGroupSummary(ResourceGroupType.UNASSIGNED, "未归属资源", unassigned));
        groups.add(new ResourceGroupSummary(ResourceGroupType.CLUSTER, "集群级资源", cluster));
        return new ServiceResourceInventory(resolvedServices, List.copyOf(groups));
    }
}
