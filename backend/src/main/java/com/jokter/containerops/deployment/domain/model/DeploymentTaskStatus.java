package com.jokter.containerops.deployment.domain.model;

public enum DeploymentTaskStatus {
    PENDING,
    ANALYZING,
    AWAITING_REVIEW,
    PREPARING,
    DEPLOYING,
    SUCCEEDED,
    FAILED
}
