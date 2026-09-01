package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildBranches;

public record BuildBranchesRequest(String cbbWebDevBranch, String archDesignBranch) {
    BuildBranches toCommand() {
        return new BuildBranches(cbbWebDevBranch, archDesignBranch);
    }
}
