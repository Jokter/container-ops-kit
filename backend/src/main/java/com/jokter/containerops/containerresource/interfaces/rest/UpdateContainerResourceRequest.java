package com.jokter.containerops.containerresource.interfaces.rest;

import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record UpdateContainerResourceRequest(@NotNull Long environmentId, @NotNull @Valid ResourceCoordinates coordinates, @NotBlank String yaml, @NotBlank String expectedResourceVersion) {
}
