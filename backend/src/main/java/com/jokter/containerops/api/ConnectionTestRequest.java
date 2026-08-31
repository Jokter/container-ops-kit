package com.jokter.containerops.api;

import com.jokter.containerops.domain.EnvironmentType;
import jakarta.validation.constraints.*;

public record ConnectionTestRequest(
    @NotNull EnvironmentType type,
    @NotBlank String host,
    @NotNull @Min(1) @Max(65535) Integer sshPort,
    @NotBlank String password
) {}