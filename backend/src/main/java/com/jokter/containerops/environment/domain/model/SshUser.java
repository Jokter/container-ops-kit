package com.jokter.containerops.environment.domain.model;

public enum SshUser {
    HUAWEI("huawei", EnvironmentType.BUILD),
    SOPUSER("sopuser", EnvironmentType.CONTAINER),
    ROOT("root", EnvironmentType.CONTAINER);

    private final String username;
    private final EnvironmentType environmentType;

    SshUser(String username, EnvironmentType environmentType) {
        this.username = username;
        this.environmentType = environmentType;
    }

    public String username() {
        return username;
    }

    public boolean supports(EnvironmentType type) {
        return environmentType == type;
    }
}
