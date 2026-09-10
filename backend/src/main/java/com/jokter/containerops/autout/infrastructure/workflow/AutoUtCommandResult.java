package com.jokter.containerops.autout.infrastructure.workflow;

public record AutoUtCommandResult(int exitCode, String output) {
    public boolean succeeded() {
        return exitCode == 0;
    }
}
