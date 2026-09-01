package com.jokter.containerops.build.domain.model;

public record BuildStep(String id, String label, BuildStepStatus status) {
    public BuildStep withStatus(BuildStepStatus next) {
        return new BuildStep(id, label, next);
    }
}
