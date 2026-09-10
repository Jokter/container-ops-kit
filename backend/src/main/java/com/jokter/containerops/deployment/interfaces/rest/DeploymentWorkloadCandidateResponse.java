package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentWorkloadCandidate;
import com.jokter.containerops.deployment.application.WorkloadKind;

public record DeploymentWorkloadCandidateResponse(String name, WorkloadKind kind, boolean deployable) {
    static DeploymentWorkloadCandidateResponse from(DeploymentWorkloadCandidate source) {
        return new DeploymentWorkloadCandidateResponse(source.name(), source.kind(), source.deployable());
    }
}
