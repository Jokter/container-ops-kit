package com.jokter.containerops.build.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "build_task")
class BuildTaskJpaEntity {
    @Id
    @Column(length = 64)
    String id;
    @Column(nullable = false, length = 16)
    String mode;
    @Column(nullable = false)
    Long environmentId;
    @Column(nullable = false, length = 128)
    String environmentName;
    @Column(nullable = false, length = 128)
    String module;
    @Column(nullable = false, length = 255)
    String baselineCbbBranch;
    @Column(nullable = false, length = 255)
    String baselineArchBranch;
    @Column(length = 255)
    String candidateCbbBranch;
    @Column(length = 255)
    String candidateArchBranch;
    @Column(nullable = false, length = 1000)
    String workspaceRoot;
    @Column(nullable = false, length = 16)
    String status;
    @Column(length = 2000)
    String error;
    @Column(nullable = false)
    Instant createdAt;
    Instant startedAt;
    Instant finishedAt;
    @Column(nullable = false)
    int completedSteps;
    @Column(nullable = false)
    long eventSequence;
    @Lob
    @Column(nullable = false)
    String stepsJson;
    @Lob
    @Column(nullable = false)
    String eventsJson;

    protected BuildTaskJpaEntity() {
    }
}
