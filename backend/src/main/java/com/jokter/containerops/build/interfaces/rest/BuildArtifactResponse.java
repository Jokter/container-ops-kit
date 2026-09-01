package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildArtifact;

import java.time.Instant;

public record BuildArtifactResponse(
        Long id,
        String buildTaskId,
        Long buildEnvironmentId,
        String module,
        String cbbWebDevBranch,
        String archDesignBranch,
        String remoteChartsRoot,
        Instant createdAt
) {
    static BuildArtifactResponse from(BuildArtifact artifact) {
        return new BuildArtifactResponse(
                artifact.id(),
                artifact.buildTaskId(),
                artifact.buildEnvironmentId(),
                artifact.module(),
                artifact.cbbWebDevBranch(),
                artifact.archDesignBranch(),
                artifact.remoteChartsRoot(),
                artifact.createdAt()
        );
    }
}
