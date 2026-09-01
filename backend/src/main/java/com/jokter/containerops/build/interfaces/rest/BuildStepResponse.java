package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildStep;
import com.jokter.containerops.build.domain.model.BuildStepStatus;

public record BuildStepResponse(String id, String label, BuildStepStatus status) {
    static BuildStepResponse from(BuildStep step) {
        return new BuildStepResponse(step.id(), step.label(), step.status());
    }
}
