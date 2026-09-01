package com.jokter.containerops.containerresource.interfaces.rest;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateContainerResourceRequest(@NotNull Long environmentId, @NotBlank String namespace, @NotBlank String serviceKey, @NotBlank String yaml) {
}
