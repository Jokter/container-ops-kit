package com.jokter.containerops.build.domain.model;

import java.time.Instant;

public record BuildArtifact(
        Long id,
        String buildTaskId,
        Long buildEnvironmentId,
        String module,
        String cbbWebDevBranch,
        String archDesignBranch,
        String remoteTaskRoot,
        String remoteArchDesignRoot,
        String remoteModuleRoot,
        String remoteChartsRoot,
        Instant createdAt
) {
    public static BuildArtifact create(
            String buildTaskId,
            Long buildEnvironmentId,
            BuildModule module,
            BuildBranches branches,
            String remoteTaskRoot
    ) {
        String archRoot = remoteTaskRoot + "/single/ArchDesign";
        String moduleRoot = archRoot + "/" + module.archDirectory();
        return new BuildArtifact(
                null,
                buildTaskId,
                buildEnvironmentId,
                module.name(),
                branches.cbbWebDev().value(),
                branches.archDesign().value(),
                remoteTaskRoot,
                archRoot,
                moduleRoot,
                moduleRoot + "/target/" + module.chartsPath(),
                Instant.now()
        );
    }
}
