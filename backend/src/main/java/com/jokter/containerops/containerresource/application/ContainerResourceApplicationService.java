package com.jokter.containerops.containerresource.application;

import com.jokter.containerops.containerresource.domain.model.ServiceResourceWorkspace;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.containerresource.domain.model.ResourceChangePreview;
import com.jokter.containerops.containerresource.domain.model.ResourceChangeResult;
import com.jokter.containerops.containerresource.domain.model.ResourceTypeSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceResources;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ContainerResourceApplicationService {
    private final ContainerResourceContextPort context;
    private final ContainerResourceRemotePort remote;

    public ContainerResourceApplicationService(ContainerResourceContextPort context, ContainerResourceRemotePort remote) {
        this.context = context;
        this.remote = remote;
    }

    public ServiceResourceWorkspace services(Long environmentId, String namespace, boolean refresh) {
        return remote.loadServices(context.target(environmentId), namespace, refresh);
    }

    public List<ResourceTypeSummary> resourceTypes(Long environmentId, boolean refresh) {
        return remote.loadResourceTypes(context.target(environmentId), refresh);
    }

    public ServiceResources serviceResources(Long environmentId, String namespace, String serviceKey) {
        return remote.loadServiceResources(context.target(environmentId), namespace, serviceKey);
    }

    public EditableResource resource(Long environmentId, ResourceCoordinates coordinates) {
        return remote.readResource(context.target(environmentId), coordinates);
    }

    public ResourceChangePreview previewUpdate(Long environmentId, ResourceCoordinates coordinates, String yaml, String expectedResourceVersion) {
        return remote.previewUpdate(context.target(environmentId), coordinates, yaml, expectedResourceVersion);
    }

    public ResourceChangeResult applyUpdate(Long environmentId, ResourceCoordinates coordinates, String yaml, String expectedResourceVersion) {
        return remote.applyUpdate(context.target(environmentId), coordinates, yaml, expectedResourceVersion);
    }

    public ResourceChangePreview previewCreate(Long environmentId, String namespace, String serviceKey, String yaml) {
        return remote.previewCreate(context.target(environmentId), namespace, serviceKey, yaml);
    }

    public ResourceChangeResult createResource(Long environmentId, String namespace, String serviceKey, String yaml) {
        return remote.createResource(context.target(environmentId), namespace, serviceKey, yaml);
    }
}
