package com.jokter.containerops.containerresource.interfaces.rest;

import com.jokter.containerops.containerresource.application.ContainerResourceApplicationService;
import com.jokter.containerops.containerresource.domain.model.ResourceTypeSummary;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.containerresource.domain.model.ResourceChangePreview;
import com.jokter.containerops.containerresource.domain.model.ResourceChangeResult;
import com.jokter.containerops.containerresource.domain.model.ServiceResources;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
@Validated
public class ContainerResourceController {
    private final ContainerResourceApplicationService application;

    public ContainerResourceController(ContainerResourceApplicationService application) {
        this.application = application;
    }

    @GetMapping("/container-resource-services")
    public ContainerResourceServicesResponse services(
            @RequestParam Long environmentId,
            @RequestParam @NotBlank String namespace,
            @RequestParam(defaultValue = "false") boolean refresh
    ) {
        return ContainerResourceServicesResponse.from(application.services(environmentId, namespace, refresh));
    }

    @GetMapping("/container-resource-types")
    public List<ResourceTypeSummary> resourceTypes(
            @RequestParam Long environmentId,
            @RequestParam(defaultValue = "false") boolean refresh
    ) {
        return application.resourceTypes(environmentId, refresh);
    }

    @GetMapping("/container-service-resources")
    public ServiceResources serviceResources(
            @RequestParam Long environmentId,
            @RequestParam @NotBlank String namespace,
            @RequestParam @NotBlank String serviceKey
    ) {
        return application.serviceResources(environmentId, namespace, serviceKey);
    }

    @GetMapping("/container-resources")
    public EditableResource resource(
            @RequestParam Long environmentId,
            @RequestParam(defaultValue = "") String group,
            @RequestParam @NotBlank String version,
            @RequestParam @NotBlank String resource,
            @RequestParam @NotBlank String namespace,
            @RequestParam @NotBlank String name
    ) {
        return application.resource(environmentId, new ResourceCoordinates(group, version, resource, namespace, name));
    }

    @PostMapping("/container-resource-changes/preview")
    public ResourceChangePreview previewUpdate(@Valid @RequestBody UpdateContainerResourceRequest request) {
        return application.previewUpdate(request.environmentId(), request.coordinates(), request.yaml(), request.expectedResourceVersion());
    }

    @PostMapping("/container-resource-changes/apply")
    public ResourceChangeResult applyUpdate(@Valid @RequestBody UpdateContainerResourceRequest request) {
        return application.applyUpdate(request.environmentId(), request.coordinates(), request.yaml(), request.expectedResourceVersion());
    }

    @PostMapping("/container-resources/preview")
    public ResourceChangePreview previewCreate(@Valid @RequestBody CreateContainerResourceRequest request) {
        return application.previewCreate(request.environmentId(), request.namespace(), request.serviceKey(), request.yaml());
    }

    @PostMapping("/container-resources")
    @ResponseStatus(HttpStatus.CREATED)
    public ResourceChangeResult createResource(@Valid @RequestBody CreateContainerResourceRequest request) {
        return application.createResource(request.environmentId(), request.namespace(), request.serviceKey(), request.yaml());
    }
}
