package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTask;

import java.time.Instant;

public record BuildTaskSummaryResponse(
        String id,
        BuildMode mode,
        Long environmentId,
        String environmentName,
        String module,
        BuildStatus status,
        int progress,
        String error,
        Instant createdAt,
        Instant finishedAt,
        String workspaceRoot
) {
    static BuildTaskSummaryResponse from(BuildTask task) {
        return new BuildTaskSummaryResponse(task.id(), task.mode(), task.environmentId(), task.environmentName(),
                task.module(), task.status(), task.progress(), task.error(), task.createdAt(), task.finishedAt(),
                task.workspaceRoot());
    }
}
