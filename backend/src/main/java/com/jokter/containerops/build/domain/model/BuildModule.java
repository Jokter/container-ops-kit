package com.jokter.containerops.build.domain.model;

import java.util.regex.Pattern;

public record BuildModule(String name, String archBuildDirTemplate, String chartsPath) {
    private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");

    public BuildModule {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("模块名称格式不正确");
        }
        validateRelativePath(archBuildDirTemplate == null ? null : archBuildDirTemplate.replace("{module}", name));
        validateRelativePath(chartsPath);
        if (chartsPath.indexOf('/') <= 0) {
            throw new IllegalArgumentException("charts_path 必须包含 Chart 根目录和产物子路径");
        }
    }

    public String archDirectory() {
        return archBuildDirTemplate.replace("{module}", name);
    }

    public String baseChartDirectory() {
        return chartsPath.substring(0, chartsPath.indexOf('/'));
    }

    private static void validateRelativePath(String path) {
        if (path == null || path.isBlank() || path.startsWith("/") || path.contains("\\") || path.contains("..") || path.contains("//")) {
            throw new IllegalArgumentException("模块路径格式不正确");
        }
    }
}
