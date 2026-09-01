package com.jokter.containerops.containerresource.application;

import com.jokter.containerops.containerresource.domain.model.ServiceResourceWorkspace;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.containerresource.domain.model.ResourceChangePreview;
import com.jokter.containerops.containerresource.domain.model.ResourceChangeResult;
import com.jokter.containerops.containerresource.domain.model.ResourceTypeSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceResources;

import java.util.List;

public interface ContainerResourceRemotePort {
    ServiceResourceWorkspace loadServices(ContainerResourceTarget target, String namespace, boolean refresh);

    List<ResourceTypeSummary> loadResourceTypes(ContainerResourceTarget target, boolean refresh);

    ServiceResources loadServiceResources(ContainerResourceTarget target, String namespace, String serviceKey);

    EditableResource readResource(ContainerResourceTarget target, ResourceCoordinates coordinates);

    ResourceChangePreview previewUpdate(ContainerResourceTarget target, ResourceCoordinates coordinates, String yaml, String expectedResourceVersion);

    ResourceChangeResult applyUpdate(ContainerResourceTarget target, ResourceCoordinates coordinates, String yaml, String expectedResourceVersion);

    ResourceChangePreview previewCreate(ContainerResourceTarget target, String namespace, String serviceKey, String yaml);

    ResourceChangeResult createResource(ContainerResourceTarget target, String namespace, String serviceKey, String yaml);
}
