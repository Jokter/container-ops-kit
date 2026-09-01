package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTask;

import java.time.Instant;
import java.util.List;

public record BuildTaskResponse(
        String id,
        BuildMode mode,
        Long environmentId,
        String environmentName,
        String module,
        BuildBranchesResponse baseline,
        BuildBranchesResponse candidate,
        BuildStatus status,
        int progress,
        String error,
        Instant createdAt,
        Instant startedAt,
        Instant finishedAt,
        List<BuildStepResponse> steps,
        List<BuildEventResponse> events
) {
    static BuildTaskResponse from(BuildTask task) {
        return new BuildTaskResponse(
                task.id(),
                task.mode(),
                task.environmentId(),
                task.environmentName(),
                task.module(),
                BuildBranchesResponse.from(task.baseline()),
                BuildBranchesResponse.from(task.candidate()),
                task.status(),
                task.progress(),
                task.error(),
                task.createdAt(),
                task.startedAt(),
                task.finishedAt(),
                task.steps().stream().map(BuildStepResponse::from).toList(),
                task.events().stream().map(BuildEventResponse::from).toList()
        );
    }
}
