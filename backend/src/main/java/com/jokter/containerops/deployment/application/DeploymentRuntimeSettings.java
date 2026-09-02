package com.jokter.containerops.deployment.application;

public interface DeploymentRuntimeSettings {
    String kubectlKubeconfig();

    String helmKubeconfig();

    String lockFile();

    String jarListFile();
}
