package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.domain.model.SshUser;
import jakarta.validation.constraints.NotNull;

public record SavedConnectionTestRequest(@NotNull SshUser user) {
}
