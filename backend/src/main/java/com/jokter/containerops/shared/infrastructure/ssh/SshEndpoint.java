package com.jokter.containerops.shared.infrastructure.ssh;

public record SshEndpoint(String host, int port, String username, String password) {
}
