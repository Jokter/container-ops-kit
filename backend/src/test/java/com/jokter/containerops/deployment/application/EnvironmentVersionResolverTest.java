package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EnvironmentVersionResolverTest {
    private final EnvironmentVersionResolver resolver = new EnvironmentVersionResolver(new ObjectMapper());

    @Test
    void readsPackageVersionsForTheTargetArchitecture() {
        String lock = """
                {"packages":[
                  {"name":"fmproductfrontendservice","version":"272.010.518","arch":"x86_64"},
                  {"name":"jre","version":"27.66.12","arch":"x86_64"},
                  {"name":"jre","version":"27.66.15","arch":"aarch64"}
                ]}
                """;

        assertThat(resolver.packageVersions(lock, "x86_64"))
                .containsEntry("fmproductfrontendservice", "272.010.518")
                .containsEntry("jre", "27.66.12")
                .hasSize(2);
    }

    @Test
    void rejectsConflictingPackageVersionsForTheSameArchitecture() {
        String lock = """
                {"packages":[
                  {"name":"jre","version":"27.66.12","arch":"x86_64"},
                  {"name":"jre","version":"27.66.15","arch":"x86_64"}
                ]}
                """;

        assertThatThrownBy(() -> resolver.packageVersions(lock, "x86_64"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("jre/x86_64")
                .hasMessageContaining("27.66.12")
                .hasMessageContaining("27.66.15");
    }

    @Test
    void readsImageAndEngineVersionsFromComputedHelmValues() {
        String values = """
                {"global":{
                  "nodePool":"mae",
                  "repo":{"address":"registry.example/default"},
                  "image":{
                    "sopBase":{"name":"sop_base_image","version":"27.66.102"},
                    "wnBase":{"name":"wn_base_image","version":"272.010.518"}
                  },
                  "cloudsop":{
                    "zenith":{"instance":{"default":{"engineVersion":"1.13.0.SPC100.B006"},"logicalBackup":{"engineVersion":"1.13.0.SPC100.B006"}}},
                    "redis":{"instance":{"default":{"engineVersion":"27.66.12"}}}
                  }
                }}
                """;

        HelmEnvironmentValues result = resolver.helmEnvironment(values);

        assertThat(result.placeholderVersions()).containsEntry("sop_base_image", "27.66.102")
                .containsEntry("wn_base_image", "272.010.518")
                .containsEntry("zenith", "1.13.0.SPC100.B006")
                .containsEntry("redis", "27.66.12");
        assertThat(result.globalOverrides()).containsEntry("nodePool", "mae")
                .containsEntry("repo.address", "registry.example/default");
    }

    @Test
    void selectsTheReleaseOwnedByTheModule() {
        List<String> releases = List.of("mae-fmematechart", "maeaccesschart", "maecommonchart");

        assertThat(resolver.releaseFor("mae-access", releases)).contains("maeaccesschart");
        assertThat(resolver.releaseFor("mae-fmemate", releases)).contains("mae-fmematechart");
    }

    @Test
    void discoversNamespaceServicesAndSelectsAReadyReplicaFromRuntimeIdentity() {
        String pods = """
                accesscommonds-0\taccesscommonds\tRunning\ttrue\tsha256:access
                fmproductfrontendservice-b\tfmproductfrontendservice\tRunning\ttrue\tsha256:fm
                fmproductfrontendservice-a\tfmproductfrontendservice\tRunning\ttrue\tsha256:fm
                wnfmproductservice-0\twnfmproduct\tRunning\ttrue\tsha256:wn
                """;

        List<RuntimeContainer> containers = resolver.runtimeContainers(pods);

        assertThat(resolver.availableServices(
                List.of("fmproductfrontendservice", "accesscommonds", "wnfmproductservice", "missing"), containers))
                .containsExactly("fmproductfrontendservice", "accesscommonds", "wnfmproductservice");
        RuntimeContainer selected = resolver.targetFor(
                new ServiceRuntimeIdentity("fmproductfrontendservice", "fmproductfrontendservice"), containers);
        assertThat(selected.pod()).isEqualTo("fmproductfrontendservice-a");
        assertThat(selected.container()).isEqualTo("fmproductfrontendservice");
    }

    @Test
    void readsCompactRuntimeContainerRows() {
        String rows = """
                fmproductfrontendservice-b\tfmproductfrontendservice\tRunning\ttrue\tsha256:fm
                fmproductfrontendservice-a\tfmproductfrontendservice\tRunning\ttrue\tsha256:fm
                accesscommonds-0\taccesscommonds\tPending\tfalse\trepo/access:1
                """;

        List<RuntimeContainer> containers = resolver.runtimeContainers(rows);

        assertThat(containers).containsExactly(
                new RuntimeContainer("fmproductfrontendservice-b", "fmproductfrontendservice", "Running", true, "sha256:fm"),
                new RuntimeContainer("fmproductfrontendservice-a", "fmproductfrontendservice", "Running", true, "sha256:fm"),
                new RuntimeContainer("accesscommonds-0", "accesscommonds", "Pending", false, "repo/access:1")
        );
    }

    @Test
    void rejectsReadyReplicasUsingDifferentContainerImages() {
        String pods = """
                fmproductfrontendservice-a\tfmproductfrontendservice\tRunning\ttrue\tsha256:one
                fmproductfrontendservice-b\tfmproductfrontendservice\tRunning\ttrue\tsha256:two
                """;

        List<RuntimeContainer> containers = resolver.runtimeContainers(pods);

        assertThatThrownBy(() -> resolver.targetFor(
                        new ServiceRuntimeIdentity("fmproductfrontendservice", "fmproductfrontendservice"), containers))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("fmproductfrontendservice-a")
                .hasMessageContaining("fmproductfrontendservice-b")
                .hasMessageContaining("镜像不一致");
    }

    @Test
    void readsWorkloadAndContainerNamesFromServiceValues() {
        String values = """
                appg:
                  name: wnfmproductservice
                  kind: StatefulSet
                wnfmproduct:
                  packageName: wnfmproductservice
                  processName: wnfmproduct
                pkgVersion:
                  wnfmproduct:
                    jre: {version}
                """;

        ServiceRuntimeIdentity identity = resolver.runtimeIdentity(values);

        assertThat(identity.workload()).isEqualTo("wnfmproductservice");
        assertThat(identity.container()).isEqualTo("wnfmproduct");
    }
}
