package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.application.AutoUtRepositoryCatalog;

import java.time.Instant;

public record AutoUtRepositoryMappingResponse(
        String repository,
        String url,
        boolean customized,
        Instant updatedAt
) {
    static AutoUtRepositoryMappingResponse from(
            String repository, AutoUtRepositoryCatalog.ResolvedRepository resolved
    ) {
        return new AutoUtRepositoryMappingResponse(
                repository, resolved.definition().url(), resolved.customized(), resolved.updatedAt());
    }
}
