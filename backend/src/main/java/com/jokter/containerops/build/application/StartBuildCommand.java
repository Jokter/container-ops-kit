package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildBranches;

public record StartBuildCommand(
        BuildMode mode,
        Long environmentId,
        String module,
        BuildBranches baseline,
        BuildBranches candidate
) {
    public StartBuildCommand {
        if (mode == null || environmentId == null || module == null || module.isBlank() || baseline == null) {
            throw new IllegalArgumentException("构建模式、构建环境和基准分支不能为空");
        }
        if (mode == BuildMode.COMPARE && candidate == null) {
            throw new IllegalArgumentException("双分支构建必须填写验证版本分支");
        }
    }
}
