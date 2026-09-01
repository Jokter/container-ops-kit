package com.jokter.containerops.build.domain.model;

import java.util.regex.Pattern;

public record BranchName(String value) {
    public static final String DEFAULT_BRANCH = "master";
    private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._/-]{0,199}");

    public BranchName {
        if (!FORMAT.matcher(value).matches() || value.contains("..") || value.contains("//") || value.endsWith("/") || value.endsWith(".")) {
            throw new IllegalArgumentException("分支名称格式不正确");
        }
    }

    public static BranchName of(String value) {
        return new BranchName(value == null || value.isBlank() ? DEFAULT_BRANCH : value.trim());
    }
}
