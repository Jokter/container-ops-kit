package com.jokter.containerops.deployment.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "deployment")
public record DeploymentConfigurationProperties(
        String kubectlKubeconfig,
        String helmKubeconfig,
        String lockFile,
        String jarListFile
) {
    public DeploymentConfigurationProperties {
        if (kubectlKubeconfig == null || kubectlKubeconfig.isBlank()
                || helmKubeconfig == null || helmKubeconfig.isBlank()
                || lockFile == null || lockFile.isBlank()
                || jarListFile == null || jarListFile.isBlank()) {
            throw new IllegalArgumentException("部署运行配置不能为空");
        }
    }
}
