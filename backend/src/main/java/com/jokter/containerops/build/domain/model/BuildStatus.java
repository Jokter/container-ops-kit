package com.jokter.containerops.build.domain.model;

public enum BuildStatus {
    PENDING,
    RUNNING,
    SUCCEEDED,
    FAILED;

    public boolean terminal() {
        return this == SUCCEEDED || this == FAILED;
    }
}
