package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.application.BuildStorageUsage;

public record BuildStorageUsageResponse(
        String path,
        long usedBytes,
        long filesystemBytes,
        long availableBytes,
        String filesystemUsage
) {
    static BuildStorageUsageResponse from(BuildStorageUsage usage) {
        return new BuildStorageUsageResponse(usage.path(), usage.usedBytes(), usage.filesystemBytes(),
                usage.availableBytes(), usage.filesystemUsage());
    }
}
