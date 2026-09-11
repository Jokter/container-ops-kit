package com.jokter.containerops.autout.application;

public record AutoUtPlan(
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
}
