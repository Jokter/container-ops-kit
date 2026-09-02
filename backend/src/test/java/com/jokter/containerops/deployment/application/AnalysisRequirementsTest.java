package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.service.ChartSource;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AnalysisRequirementsTest {
    @Test
    void requestsOnlyDataUsedBySourceFiles() {
        AnalysisRequirements empty = AnalysisRequirements.from(List.of(
                new ChartSource("replicas: 1\n", "version: 1.0.0\n", "", Map.of())));
        AnalysisRequirements required = AnalysisRequirements.from(List.of(
                new ChartSource(
                        "pkgVersion:\n  svc:\n    jre: {version}\njars:\n  svc: replaceByBuild\n",
                        "version: {version}\n",
                        "global:\n  image:\n    svc:\n      version: {version:svc}\n",
                        Map.of())));

        assertThat(empty.packageVersions()).isFalse();
        assertThat(empty.jarList()).isFalse();
        assertThat(empty.helmValues()).isFalse();
        assertThat(required.packageVersions()).isTrue();
        assertThat(required.jarList()).isTrue();
        assertThat(required.helmValues()).isTrue();
    }
}
