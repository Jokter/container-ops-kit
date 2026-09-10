package com.jokter.containerops.autout.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "auto_ut_task")
class AutoUtTaskJpaEntity {
    @Id
    String id;
    String repository;
    String username;
    String ticket;
    String baseBranch;
    String repairBranch;
    int reportedFailedTests;
    double lineGoal;
    double branchGoal;
    String workspaceRoot;
    String executionMode;
    String status;
    String nextStage;
    int progress;
    int attempts;
    @Column(length = 4000)
    String message;
    @Column(length = 2000)
    String pullRequestUrl;
    Instant createdAt;
    Instant updatedAt;
    @Lob
    String historyJson;

    protected AutoUtTaskJpaEntity() {
    }
}
