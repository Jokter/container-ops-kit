package com.jokter.containerops.build.application;

public final class BuildDefinition {
    public static final String CBB_WEB_DEV_REPOSITORY = "https://szv-y.codehub.huawei.com/MAE-M/Common/CBB-Web-Dev.git";
    public static final String ARCH_DESIGN_REPOSITORY = "https://szv-y.codehub.huawei.com/MAE-M/CI/ArchDesign.git";
    public static final String BUILD_COMMAND = "mvn clean install -Dmaven.test.skip=true -Dbuild.package.type=DOCKER";

    private BuildDefinition() {
    }
}
