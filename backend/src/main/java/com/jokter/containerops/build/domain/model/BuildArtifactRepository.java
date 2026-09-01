package com.jokter.containerops.build.domain.model;

import java.util.List;
import java.util.Optional;

public interface BuildArtifactRepository {
    BuildArtifact save(BuildArtifact artifact);

    List<BuildArtifact> findAll();

    Optional<BuildArtifact> findById(Long id);
}
