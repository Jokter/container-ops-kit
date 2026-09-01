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
        String workspaceRoot,
        List<BuildDirectoryResponse> directories,
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
                task.workspaceRoot(),
                directories(task),
                task.steps().stream().map(BuildStepResponse::from).toList(),
                task.events().stream().map(BuildEventResponse::from).toList()
        );
    }

    private static List<BuildDirectoryResponse> directories(BuildTask task) {
        String root = task.workspaceRoot();
        if (task.mode() == BuildMode.SINGLE) {
            return List.of(
                    new BuildDirectoryResponse("CBB-Web-Dev", root + "/single/CBB-Web-Dev/chart-codegen-plugin"),
                    new BuildDirectoryResponse(task.module(), root + "/single/ArchDesign/Chart/" + task.module())
            );
        }
        return List.of(
                new BuildDirectoryResponse("基准 · CBB-Web-Dev", root + "/baseline/CBB-Web-Dev/chart-codegen-plugin"),
                new BuildDirectoryResponse("基准 · " + task.module(), root + "/baseline/ArchDesign/Chart/" + task.module()),
                new BuildDirectoryResponse("验证 · CBB-Web-Dev", root + "/candidate/CBB-Web-Dev/chart-codegen-plugin"),
                new BuildDirectoryResponse("验证 · " + task.module(), root + "/candidate/ArchDesign/Chart/" + task.module())
        );
    }
}
