package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtRepositoryMapping;

import java.util.Optional;

public interface AutoUtRepositoryMappingRepository {
    Optional<AutoUtRepositoryMapping> find(String repository);
    AutoUtRepositoryMapping save(AutoUtRepositoryMapping mapping);
}
