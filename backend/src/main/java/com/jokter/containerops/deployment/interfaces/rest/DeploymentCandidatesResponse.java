package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentCandidates;

import java.util.List;

public record DeploymentCandidatesResponse(
        String module,
        List<DeploymentWorkloadCandidateResponse> workloads,
        List<String> namespaces
) {
    static DeploymentCandidatesResponse from(DeploymentCandidates source) {
        return new DeploymentCandidatesResponse(
                source.module(),
                source.workloads().stream().map(DeploymentWorkloadCandidateResponse::from).toList(),
                source.namespaces());
    }
}
