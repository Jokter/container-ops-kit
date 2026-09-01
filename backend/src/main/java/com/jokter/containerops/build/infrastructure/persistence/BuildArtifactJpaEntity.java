package com.jokter.containerops.build.infrastructure.persistence;

import com.jokter.containerops.build.domain.model.BuildArtifact;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "build_artifact")
class BuildArtifactJpaEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    Long id;
    @Column(name = "build_task_id", nullable = false, unique = true)
    String buildTaskId;
    @Column(name = "build_environment_id", nullable = false)
    Long buildEnvironmentId;
    @Column(nullable = false)
    String module;
    @Column(name = "cbb_web_dev_branch", nullable = false)
    String cbbWebDevBranch;
    @Column(name = "arch_design_branch", nullable = false)
    String archDesignBranch;
    @Column(name = "remote_task_root", nullable = false, length = 1000)
    String remoteTaskRoot;
    @Column(name = "remote_arch_design_root", nullable = false, length = 1000)
    String remoteArchDesignRoot;
    @Column(name = "remote_module_root", nullable = false, length = 1000)
    String remoteModuleRoot;
    @Column(name = "remote_charts_root", nullable = false, length = 1000)
    String remoteChartsRoot;
    @Column(name = "created_at", nullable = false)
    Instant createdAt;

    protected BuildArtifactJpaEntity() {
    }

    static BuildArtifactJpaEntity from(BuildArtifact artifact) {
        BuildArtifactJpaEntity entity = new BuildArtifactJpaEntity();
        entity.buildTaskId = artifact.buildTaskId();
        entity.buildEnvironmentId = artifact.buildEnvironmentId();
        entity.module = artifact.module();
        entity.cbbWebDevBranch = artifact.cbbWebDevBranch();
        entity.archDesignBranch = artifact.archDesignBranch();
        entity.remoteTaskRoot = artifact.remoteTaskRoot();
        entity.remoteArchDesignRoot = artifact.remoteArchDesignRoot();
        entity.remoteModuleRoot = artifact.remoteModuleRoot();
        entity.remoteChartsRoot = artifact.remoteChartsRoot();
        entity.createdAt = artifact.createdAt();
        return entity;
    }

    BuildArtifact toDomain() {
        return new BuildArtifact(id, buildTaskId, buildEnvironmentId, module, cbbWebDevBranch, archDesignBranch, remoteTaskRoot, remoteArchDesignRoot, remoteModuleRoot, remoteChartsRoot, createdAt);
    }
}
