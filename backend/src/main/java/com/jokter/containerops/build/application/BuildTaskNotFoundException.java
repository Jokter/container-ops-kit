package com.jokter.containerops.build.application;

public class BuildTaskNotFoundException extends RuntimeException {
    public BuildTaskNotFoundException() {
        super("构建任务不存在或服务已重启");
    }
}
