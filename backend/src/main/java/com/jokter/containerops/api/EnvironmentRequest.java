package com.jokter.containerops.api;

import com.jokter.containerops.domain.EnvironmentType;
import jakarta.validation.constraints.*;

public record EnvironmentRequest(
    @NotNull Long releaseVersionId,
    @NotNull EnvironmentType type,
    @NotBlank String name,
    @NotBlank String host,
    @NotNull @Min(1) @Max(65535) Integer sshPort,
    @NotBlank String password,
    String workDirectory,
    String architecture,
    String mae,
    String maeUser,
    String maePassword,
    String osmu,
    String osmuUser,
    String osmuPassword,
    Long version
) {}