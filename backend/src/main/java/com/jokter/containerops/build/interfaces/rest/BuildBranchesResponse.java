package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildBranches;

public record BuildBranchesResponse(String cbbWebDevBranch, String archDesignBranch) {
    static BuildBranchesResponse from(BuildBranches branches) {
        if (branches == null) {
            return null;
        }
        return new BuildBranchesResponse(branches.cbbWebDev().value(), branches.archDesign().value());
    }
}
