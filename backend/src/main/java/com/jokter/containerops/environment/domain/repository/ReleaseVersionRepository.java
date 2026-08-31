package com.jokter.containerops.environment.domain.repository;

import com.jokter.containerops.environment.domain.model.ReleaseVersion;
import java.util.List;
import java.util.Optional;

public interface ReleaseVersionRepository {
    List<ReleaseVersion> findAll();
    Optional<ReleaseVersion> findById(Long id);
}