package com.jokter.containerops.autout.domain.model;

public enum AutoUtTaskStatus {
    DISCOVERED,
    WAITING_CONFIRMATION,
    WAITING_REPOSITORY,
    PREPARING,
    BASELINE_RUNNING,
    REPAIRING,
    VERIFYING,
    RETRY_PENDING,
    WAITING_EXTERNAL,
    PR_CREATING,
    RESOLVED;

    public boolean inProgress() {
        return this == DISCOVERED || this == PREPARING || this == BASELINE_RUNNING
                || this == REPAIRING || this == VERIFYING || this == PR_CREATING;
    }
}
