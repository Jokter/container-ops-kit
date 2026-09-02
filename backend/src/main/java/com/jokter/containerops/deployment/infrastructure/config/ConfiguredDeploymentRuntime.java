package com.jokter.containerops.deployment.infrastructure.config;

import com.jokter.containerops.deployment.application.DeploymentRuntimeSettings;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@EnableConfigurationProperties(DeploymentConfigurationProperties.class)
class ConfiguredDeploymentRuntime implements DeploymentRuntimeSettings {
    private final DeploymentConfigurationProperties properties;

    ConfiguredDeploymentRuntime(DeploymentConfigurationProperties properties) {
        this.properties = properties;
    }

    @Override
    public String kubectlKubeconfig() {
        return properties.kubectlKubeconfig();
    }

    @Override
    public String helmKubeconfig() {
        return properties.helmKubeconfig();
    }

    @Override
    public String lockFile() {
        return properties.lockFile();
    }

    @Override
    public String jarListFile() {
        return properties.jarListFile();
    }
}
