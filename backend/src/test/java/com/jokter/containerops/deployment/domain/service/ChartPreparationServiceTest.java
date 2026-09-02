package com.jokter.containerops.deployment.domain.service;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChartPreparationServiceTest {
    @Test
    void replacesComponentImageJarAndChartVersionsWithoutHidingUnknownImages() {
        ChartPreparationService service = new ChartPreparationService();
        ChartSource source = new ChartSource(
                "pkgVersion:\n  svc:\n    cbb_engr: {version}\njars:\n  svc: replaceByBuild\nimage: repo/svc:{version:svc}\nother: {version:missing}\n",
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

    @Test
    void replacesVersionPlaceholdersAfterMergingModuleGlobalValues() {
        ChartSource source = new ChartSource(
                "appg:\n  name: fmproductfrontendservice\npkgVersion:\n  fmproductfrontendservice:\n    jre: {version}\n",
                "name: fmproductfrontendservice\nversion: {version}\n",
                "global:\n  image:\n    sopBase:\n      name: sop_base_image\n      version: {version:sop_base_image}\n  cloudsop:\n    zenith:\n      instance:\n        default:\n          engineVersion: {version:zenith}\n",
                Map.of()
        );
        EnvironmentSnapshot environment = new EnvironmentSnapshot(
                Map.of("jre", "27.66.12", "fmproductfrontendservice", "272.010.518"),
                Map.of("sop_base_image", "27.66.102", "zenith", "1.13.0.SPC100.B006"),
                "",
                Map.of()
        );

        PreparedChart result = new ChartPreparationService().prepare("fmproductfrontendservice", source, environment);

        assertThat(result.values()).contains("jre: 27.66.12");
        assertThat(result.values()).contains("version: 27.66.102");
        assertThat(result.values()).contains("engineVersion: 1.13.0.SPC100.B006");
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void keepsMissingPackageVersionUnresolvedInsteadOfUsingTheServiceVersion() {
        ChartSource source = new ChartSource(
                "pkgVersion:\n  svc:\n    jre: {version}\n    missing: {version}\nserviceVersion: {version}\n",
                "name: svc\nversion: {version}\n",
                "",
                Map.of()
        );
        EnvironmentSnapshot environment = new EnvironmentSnapshot(
                Map.of("jre", "27.66.12", "svc", "272.010.518"),
                Map.of(),
                "",
                Map.of()
        );

        PreparedChart result = new ChartPreparationService().prepare("svc", source, environment);

        assertThat(result.values()).contains("jre: 27.66.12");
        assertThat(result.values()).contains("missing: {version}");
        assertThat(result.values()).contains("serviceVersion: 272.010.518");
        assertThat(result.errors()).contains("存在未解析占位符：{version}");
    }
}
