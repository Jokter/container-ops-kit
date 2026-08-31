package com.jokter.containerops.environment.application;

public interface SshConnectionPort {
    ConnectionTestResult test(ConnectionTestCommand command);
}