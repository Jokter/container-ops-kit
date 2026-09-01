package com.jokter.containerops.containerresource.application;

public record ContainerResourceTarget(
        Long environmentId,
        String environmentName,
        String host,
        int port,
        String username,
        String password
) {
}
