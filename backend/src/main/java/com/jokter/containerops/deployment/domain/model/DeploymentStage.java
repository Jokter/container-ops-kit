package com.jokter.containerops.deployment.domain.model;

public enum DeploymentStage {
    PENDING,
    ANALYZED,
    GENERATED,
    RENDERED,
    DEPLOYING,
    SUCCEEDED,
    FAILED
}
