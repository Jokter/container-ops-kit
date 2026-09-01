package com.jokter.containerops.build.infrastructure.config;

import com.jokter.containerops.build.application.BuildModuleCatalog;
import com.jokter.containerops.build.domain.model.BuildModule;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@EnableConfigurationProperties(BuildConfigurationProperties.class)
class ConfiguredBuildModuleCatalog implements BuildModuleCatalog {
    private final List<BuildModule> modules;

    ConfiguredBuildModuleCatalog(BuildConfigurationProperties properties) {
        modules = properties.modules().stream()
                .map(module -> new BuildModule(module.name(), properties.archBuildDirTemplate(), module.chartsPath()))
                .toList();
        if (modules.stream().map(BuildModule::name).distinct().count() != modules.size()) {
            throw new IllegalArgumentException("构建模块名称不能重复");
        }
    }

    @Override
    public List<BuildModule> findAll() {
        return modules;
    }

    @Override
    public BuildModule get(String name) {
        return modules.stream().filter(module -> module.name().equals(name)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("构建模块不存在"));
    }
}
