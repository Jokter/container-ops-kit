package com.jokter.containerops.build.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "build")
public record BuildConfigurationProperties(String archBuildDirTemplate, List<ModuleProperties> modules) {
    public record ModuleProperties(String name, String chartsPath) {
    }
}
