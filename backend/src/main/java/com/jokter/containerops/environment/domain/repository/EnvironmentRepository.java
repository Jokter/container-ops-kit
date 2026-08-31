package com.jokter.containerops.environment.domain.repository;

import com.jokter.containerops.environment.domain.model.Environment;
import java.util.List;
import java.util.Optional;

public interface EnvironmentRepository {
    List<Environment> findAll();
    Optional<Environment> findById(Long id);
    Environment save(Environment environment);
    void delete(Environment environment);
}