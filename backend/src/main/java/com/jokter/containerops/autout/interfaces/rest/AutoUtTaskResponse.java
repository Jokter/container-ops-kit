package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.domain.model.AutoUtTask;

import java.time.Instant;
import java.util.List;

public record AutoUtTaskResponse(
        String id,
        String repository,
        String username,
        String ticket,
        String baseBranch,
        String repairBranch,
        int reportedFailedTests,
        double lineGoal,
        double branchGoal,
        String workspaceRoot,
        String executionMode,
        String status,
        String nextStage,
        int progress,
        int attempts,
        String message,
        String pullRequestUrl,
        Instant createdAt,
        Instant updatedAt,
        List<AutoUtTaskEventResponse> history
) {
    static AutoUtTaskResponse from(AutoUtTask task) {
        return new AutoUtTaskResponse(
                task.id(), task.repository(), task.username(), task.ticket(), task.baseBranch(), task.repairBranch(),
                task.reportedFailedTests(), task.lineGoal(), task.branchGoal(), task.workspaceRoot(),
                task.executionMode().name(), task.status().name(), task.nextStage().name(), task.progress(), task.attempts(),
                task.message(), task.pullRequestUrl(), task.createdAt(), task.updatedAt(),
                task.history().stream().map(AutoUtTaskEventResponse::from).toList()
        );
    }
}
