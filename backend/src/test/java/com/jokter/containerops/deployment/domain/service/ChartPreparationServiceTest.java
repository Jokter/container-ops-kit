package com.jokter.containerops.deployment.domain.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChartPreparationServiceTest {
    @Test
    void replacesComponentImageJarAndChartVersionsWithoutHidingUnknownImages() {
        ChartPreparationService service = new ChartPreparationService();
        ChartSource source = new ChartSource(
                "pkgVersion:\n  cbb_engr: {version}\njars:\n  svc: replaceByBuild\nimage: repo/svc:{version:svc}\nother: {version:missing}\n",
                "name: svc\nversion: {version}\n",
                "global:\n  nodePool: old\n",
                Map.of()
        );
        EnvironmentSnapshot environment = new EnvironmentSnapshot(
                Map.of("cbb_engr", "1.2.3", "svc", "2.0.0"),
                Map.of("svc", "2.0.1-x86_64"),
                "a.jar,b.jar",
                Map.of("nodePool", "new")
        );

        PreparedChart result = service.prepare("svc", source, environment);

        assertThat(result.values()).contains("cbb_engr: 1.2.3");
        assertThat(result.values()).contains("svc: 'a.jar,b.jar'");
        assertThat(result.values()).contains("repo/svc:2.0.1-x86_64");
        assertThat(result.chart()).contains("version: 2.0.0");
        assertThat(result.unresolvedImages()).containsExactly("missing");
        assertThat(result.values()).contains("nodePool: 'new'");
    }

    @Test
    void replacesOnlyTheConfiguredNestedGlobalPath() {
        ChartSource source = new ChartSource(
                "service:\n  version: {version}\n",
                "name: svc\nversion: {version}\n",
                "global:\n  address: keep\n  repo:\n    address: old\n  domains:\n    internal: old.example\n",
                Map.of()
        );
        EnvironmentSnapshot environment = new EnvironmentSnapshot(
                Map.of("svc", "1.0.0"),
                Map.of(),
                "",
                Map.of("repo.address", "registry.example", "domains", "{\"internal\":\"new.example\"}")
        );

        PreparedChart result = new ChartPreparationService().prepare("svc", source, environment);

        assertThat(result.values()).contains("address: keep");
        assertThat(result.values()).contains("address: 'registry.example'");
        assertThat(result.values()).contains("domains: {\"internal\":\"new.example\"}");
        assertThat(result.values()).doesNotContain("internal: old.example");
    }
}
