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
    void usesOnlyUnambiguousCachedImageTags() {
        String images = """
                {"images":[
                  {"repoTags":["registry/default/sop_base_image-x86_64:27.66.102"]},
                  {"repoTags":["registry/default/wn_base_image-x86_64:272.010.518","registry/default/wn_base_image-x86_64:271.1.1"]}
                ]}
                """;

        assertThat(resolver.imageVersions(images))
                .containsEntry("sop_base_image", "27.66.102")
                .doesNotContainKey("wn_base_image")
                .hasSize(1);
    }

    @Test
    void selectsTheReleaseOwnedByTheModule() {
        List<String> releases = List.of("mae-fmematechart", "maeaccesschart", "maecommonchart");

        assertThat(resolver.releaseFor("mae-access", releases)).contains("maeaccesschart");
        assertThat(resolver.releaseFor("mae-fmemate", releases)).contains("mae-fmematechart");
    }
}
