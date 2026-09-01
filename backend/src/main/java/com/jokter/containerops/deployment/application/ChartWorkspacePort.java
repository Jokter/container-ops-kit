package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.PreparedService;

import java.util.Map;

public interface ChartWorkspacePort {
    void write(String preparationId, PreparedService service);

    Map<String, byte[]> files(String preparationId, String service);
}
