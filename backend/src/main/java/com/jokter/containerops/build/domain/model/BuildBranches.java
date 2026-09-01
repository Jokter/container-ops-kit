package com.jokter.containerops.build.domain.model;

public record BuildBranches(BranchName cbbWebDev, BranchName archDesign) {
    public BuildBranches(String cbbWebDev, String archDesign) {
        this(BranchName.of(cbbWebDev), BranchName.of(archDesign));
    }
}
