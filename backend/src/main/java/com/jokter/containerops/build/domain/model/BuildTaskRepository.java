package com.jokter.containerops.build.domain.model;

import java.util.Optional;
import java.util.List;

public interface BuildTaskRepository {
    void save(BuildTask task);

    Optional<BuildTask> findById(String id);

    List<BuildTask> findAll();

    void deleteById(String id);
}
