package com.jokter.containerops.build.application;

public record RemoteTarget(String host, int port, String username, String password) {
}
