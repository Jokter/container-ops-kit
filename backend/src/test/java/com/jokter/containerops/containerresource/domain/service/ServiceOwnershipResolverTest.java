package com.jokter.containerops.containerresource.domain.service;

import com.jokter.containerops.containerresource.domain.model.ObservedResource;
import com.jokter.containerops.containerresource.domain.model.ResourceGroupType;
import com.jokter.containerops.containerresource.domain.model.ServiceSource;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ServiceOwnershipResolverTest {
    private final ServiceOwnershipResolver resolver = new ServiceOwnershipResolver();

    @Test
    void separatesServiceSharedUnassignedAndClusterResources() {
        ServiceResourceInventory inventory = resolver.resolve(
                List.of(
                        new ServiceSummary("helm:demo-service", "demo-service", ServiceSource.HELM_RELEASE, "NORMAL", 0),
                        new ServiceSummary("helm:common-service", "common-service", ServiceSource.HELM_RELEASE, "NORMAL", 0)
                ),
                List.of(
                        new ObservedResource("apps", "v1", "deployments", "demo-service", false, Set.of("helm:demo-service")),
                        new ObservedResource("", "v1", "configmaps", "shared-config", false, Set.of("helm:demo-service", "helm:common-service")),
                        new ObservedResource("example.io", "v1", "widgets", "legacy-widget", false, Set.of()),
                        new ObservedResource("apiextensions.k8s.io", "v1", "customresourcedefinitions", "widgets.example.io", true, Set.of())
                )
        );

        assertThat(inventory.services())
                .extracting(ServiceSummary::key, ServiceSummary::resourceCount)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("helm:common-service", 0),
                        org.assertj.core.groups.Tuple.tuple("helm:demo-service", 1)
                );
        assertThat(inventory.groups())
                .extracting(group -> group.type(), group -> group.resourceCount())
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(ResourceGroupType.SHARED, 1),
                        org.assertj.core.groups.Tuple.tuple(ResourceGroupType.UNASSIGNED, 1),
                        org.assertj.core.groups.Tuple.tuple(ResourceGroupType.CLUSTER, 1)
                );
    }
}
