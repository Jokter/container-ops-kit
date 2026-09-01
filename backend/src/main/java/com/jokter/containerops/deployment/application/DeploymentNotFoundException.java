package com.jokter.containerops.deployment.application;

public class DeploymentNotFoundException extends RuntimeException {
    public DeploymentNotFoundException(String message) { super(message); }
}
