package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.service.ChartSource;

import java.util.Collection;
import java.util.regex.Pattern;

record AnalysisRequirements(boolean packageVersions, boolean jarList, boolean helmValues) {
    private static final Pattern ENVIRONMENT_VERSION = Pattern.compile("\\{version:[A-Za-z0-9_.-]+}");
    private static final Pattern ENVIRONMENT_GLOBAL = Pattern.compile("(?m)^[ \\t]*(nodePool|domains|repo)[ \\t]*:");

    static AnalysisRequirements from(Collection<ChartSource> sources) {
        boolean packages = false;
        boolean jars = false;
        boolean helm = false;
        for (ChartSource source : sources) {
            String versionSources = source.values() + "\n" + source.chart() + "\n" + source.globalBlock();
            packages |= versionSources.contains("{version}");
            jars |= source.values().contains("replaceByBuild");
            helm |= ENVIRONMENT_VERSION.matcher(versionSources).find()
                    || ENVIRONMENT_GLOBAL.matcher(source.globalBlock()).find();
        }
        return new AnalysisRequirements(packages, jars, helm);
    }

    boolean runtimeContainers() {
        return packageVersions || jarList;
    }
}
