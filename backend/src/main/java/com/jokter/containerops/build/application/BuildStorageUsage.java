package com.jokter.containerops.build.application;

public record BuildStorageUsage(
        String path,
        long usedBytes,
        long filesystemBytes,
        long availableBytes,
        String filesystemUsage
) {
}
