package com.jokter.containerops.deployment.application;

public enum WorkloadKind {
    DEPLOYMENT,
    STATEFUL_SET,
    UNKNOWN;

    static WorkloadKind fromKubernetesKind(String value) {
        return switch (value) {
            case "Deployment" -> DEPLOYMENT;
            case "StatefulSet" -> STATEFUL_SET;
            default -> throw new IllegalStateException("不支持的工作负载类型：" + value);
        };
    }
}
