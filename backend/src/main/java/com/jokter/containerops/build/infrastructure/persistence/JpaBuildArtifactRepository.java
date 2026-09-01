package com.jokter.containerops.build.infrastructure.persistence;

import com.jokter.containerops.build.domain.model.BuildArtifact;
import com.jokter.containerops.build.domain.model.BuildArtifactRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
class JpaBuildArtifactRepository implements BuildArtifactRepository {
    private final SpringDataBuildArtifactRepository artifacts;

    JpaBuildArtifactRepository(SpringDataBuildArtifactRepository artifacts) {
        this.artifacts = artifacts;
    }

    @Override
    public BuildArtifact save(BuildArtifact artifact) {
        return artifacts.save(BuildArtifactJpaEntity.from(artifact)).toDomain();
    }

    @Override
    public List<BuildArtifact> findAll() {
        return artifacts.findAllByOrderByCreatedAtDesc().stream().map(BuildArtifactJpaEntity::toDomain).toList();
    }

    @Override
    public Optional<BuildArtifact> findById(Long id) {
        return artifacts.findById(id).map(BuildArtifactJpaEntity::toDomain);
    }

    @Override
    @Transactional
    public void deleteByBuildTaskId(String buildTaskId) {
        artifacts.deleteByBuildTaskId(buildTaskId);
    }
}
