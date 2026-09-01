package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.domain.model.DeploymentStage;
import com.jokter.containerops.deployment.domain.model.PreparedService;
import com.jokter.containerops.deployment.domain.model.ReplaceItem;

import java.util.List;
import java.util.Set;

public record PreparedServiceResponse(
        String service,
        DeploymentStage stage,
        String stageError,
        String values,
        List<ReplaceItem> replaceItems,
        Set<String> unresolvedImages,
        List<String> errors
) {
    static PreparedServiceResponse from(PreparedService source) {
        if (source == null) return null;
        return new PreparedServiceResponse(source.service(), source.stage(), source.stageError(), source.values(), source.replaceItems(), source.unresolvedImages(), source.errors());
    }
}
