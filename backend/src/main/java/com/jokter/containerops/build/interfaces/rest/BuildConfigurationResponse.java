package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.application.BuildDefinition;
import com.jokter.containerops.build.domain.model.BranchName;
import com.jokter.containerops.build.domain.model.BuildModule;

import java.util.List;

public record BuildConfigurationResponse(
        String cbbWebDevRepository,
        String archDesignRepository,
        String defaultBranch,
        String buildCommand,
        List<BuildModuleResponse> modules
) {
    static BuildConfigurationResponse fixed(List<BuildModule> modules) {
        return new BuildConfigurationResponse(
                BuildDefinition.CBB_WEB_DEV_REPOSITORY,
                BuildDefinition.ARCH_DESIGN_REPOSITORY,
                BranchName.DEFAULT_BRANCH,
                BuildDefinition.BUILD_COMMAND,
                modules.stream().map(BuildModuleResponse::from).toList()
        );
    }
}
