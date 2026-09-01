package com.jokter.containerops.build.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

interface SpringDataBuildArtifactRepository extends JpaRepository<BuildArtifactJpaEntity, Long> {
    List<BuildArtifactJpaEntity> findAllByOrderByCreatedAtDesc();
}
