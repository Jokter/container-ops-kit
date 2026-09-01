package com.jokter.containerops.build.domain.model;

import java.util.Optional;

public interface BuildTaskRepository {
    void save(BuildTask task);

    Optional<BuildTask> findById(String id);
}
