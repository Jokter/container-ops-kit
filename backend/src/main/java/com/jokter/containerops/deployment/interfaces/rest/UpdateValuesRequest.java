package com.jokter.containerops.deployment.interfaces.rest;

import jakarta.validation.constraints.NotNull;

public record UpdateValuesRequest(@NotNull String values) {
}
