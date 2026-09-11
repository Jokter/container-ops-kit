package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.application.AutoUtPlan;

public record AutoUtPlanResponse(
        String repository,
        int failedTests,
        double lineCoverage,
        double lineGoal,
        double branchCoverage,
        double branchGoal,
        boolean configured,
        String repositoryUrl,
        boolean repositoryCustomized,
        String baseBranch,
        String repairBranch
) {
    static AutoUtPlanResponse from(AutoUtPlan plan) {
        return new AutoUtPlanResponse(
                plan.repository(), plan.failedTests(), plan.lineCoverage(), plan.lineGoal(),
                plan.branchCoverage(), plan.branchGoal(), plan.configured(), plan.repositoryUrl(),
                plan.repositoryCustomized(), plan.baseBranch(), plan.repairBranch()
        );
    }
}
