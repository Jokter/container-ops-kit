package com.jokter.containerops.build.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

interface SpringDataBuildTaskRepository extends JpaRepository<BuildTaskJpaEntity, String> {
    List<BuildTaskJpaEntity> findAllByOrderByCreatedAtDesc();
}
