package com.jokter.containerops.autout.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;
import java.util.Map;

@ConfigurationProperties(prefix = "auto-ut")
public record AutoUtConfigurationProperties(
        String logDirectory,
        String language,
        String plGroup,
        Repair repair,
        Guard guard,
        Scm scm,
        Repository repositoryTemplate,
        Map<String, Repository> repositories
) {
    public record Repair(String command, String thinkingLevel, int timeoutMinutes, int maxAttemptsPerRun) {
    }

    public record Guard(List<String> forbiddenMarkers) {
    }

    public record Scm(
            String command,
            boolean createMergeRequest,
            String reviewers,
            String approvers,
            String assignees
    ) {
    }

    public record Repository(
            String url,
            List<String> testCommand,
            List<String> verificationCommand,
            String coverageReport
    ) {
    }
}
