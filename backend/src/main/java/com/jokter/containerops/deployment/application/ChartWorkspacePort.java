package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.PreparedService;

import java.util.Map;

public interface ChartWorkspacePort {
    void write(String taskId, PreparedService service);

    Map<String, byte[]> files(String taskId, String service);
}
