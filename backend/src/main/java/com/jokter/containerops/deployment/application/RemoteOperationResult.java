package com.jokter.containerops.deployment.application;

public record RemoteOperationResult(int exitCode, String output) {
    public boolean succeeded() { return exitCode == 0; }
}
