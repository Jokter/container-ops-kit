package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildModule;

public record BuildModuleResponse(String name, String chartsPath) {
    static BuildModuleResponse from(BuildModule module) {
        return new BuildModuleResponse(module.name(), module.chartsPath());
    }
}
