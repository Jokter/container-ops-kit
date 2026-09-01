package com.jokter.containerops.build.application;

public record RemoteCommandResult(int exitCode) {
    public boolean succeeded() {
        return exitCode == 0;
    }
}
