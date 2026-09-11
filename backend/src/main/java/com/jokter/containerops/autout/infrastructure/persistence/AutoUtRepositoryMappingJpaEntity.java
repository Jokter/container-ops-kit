package com.jokter.containerops.autout.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "auto_ut_repository_mapping")
class AutoUtRepositoryMappingJpaEntity {
    @Id
    String repository;
    @Column(length = 2000, nullable = false)
    String url;
    @Column(nullable = false)
    Instant updatedAt;

    protected AutoUtRepositoryMappingJpaEntity() {
    }
}
