package com.jokter.containerops.build.application;

public record BuildEnvironment(
        Long id,
        String name,
        String host,
        int sshPort,
        String username,
        String password,
        String workDirectory
) {
}
