package com.jokter.containerops.autout.domain.model;

public record AutoUtReportItem(
        String repository,
        String language,
        String plGroup,
        int failedTests,
        double lineCoverage,
        double lineGoal,
        double branchCoverage,
        double branchGoal
) {
    public boolean needsRepair() {
        return failedTests > 0 || lineCoverage < lineGoal || branchCoverage < branchGoal;
    }
}
