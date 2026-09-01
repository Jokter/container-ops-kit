package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.application.StartBuildCommand;
import com.jokter.containerops.build.domain.model.BuildMode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

public record StartBuildRequest(
        @NotNull BuildMode mode,
        @NotNull Long environmentId,
        @NotNull String module,
        @NotNull @Valid BuildBranchesRequest baseline,
        @Valid BuildBranchesRequest candidate
) {
    @AssertTrue(message = "双分支构建必须填写验证版本分支")
    public boolean isCandidateValid() {
        return mode != BuildMode.COMPARE || candidate != null;
    }

    StartBuildCommand toCommand() {
        return new StartBuildCommand(mode, environmentId, module, baseline.toCommand(), candidate == null ? null : candidate.toCommand());
    }
}
