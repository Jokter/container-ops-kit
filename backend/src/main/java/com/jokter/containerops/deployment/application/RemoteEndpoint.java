package com.jokter.containerops.deployment.application;

public record RemoteEndpoint(String host, int port, String username, String password) {
}
