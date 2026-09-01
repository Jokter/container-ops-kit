package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentCandidates;

import java.util.List;

public record DeploymentCandidatesResponse(String module, List<String> services, List<String> namespaces) {
    static DeploymentCandidatesResponse from(DeploymentCandidates source) {
        return new DeploymentCandidatesResponse(source.module(), source.services(), source.namespaces());
    }
}
