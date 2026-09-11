package com.jokter.containerops.autout.infrastructure.config;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ConfiguredAutoUtSettingsTest {
    @Test
    void 根据Csv代码仓名称生成CodeHub仓库地址() {
        var template = new AutoUtConfigurationProperties.Repository(
                "ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/{repository}.git",
                List.of("mvn", "test"), List.of("mvn", "verify"), "target/site/jacoco/jacoco.xml"
        );
        var properties = new AutoUtConfigurationProperties(
                "build/logs", "Java", "Access_智能监控组",
                new AutoUtConfigurationProperties.Repair("pi", "medium", 30, 3),
                new AutoUtConfigurationProperties.Guard(List.of("@Disabled")),
                new AutoUtConfigurationProperties.Scm("codehub-cli", true, "", "", ""),
                template, Map.of()
        );

        var repository = new ConfiguredAutoUtSettings(properties).repository("FMInsightService").orElseThrow();

        assertThat(repository.name()).isEqualTo("fminsightservice");
        assertThat(repository.url()).isEqualTo(
                "ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/FMInsightService.git");
        assertThat(repository.testCommand()).containsExactly("mvn", "test");
    }

    @Test
    void 显式仓库配置优先于通用模板() {
        var template = new AutoUtConfigurationProperties.Repository(
                "ssh://host/default/{repository}.git", List.of("mvn", "test"),
                List.of("mvn", "verify"), "target/jacoco.xml"
        );
        var override = new AutoUtConfigurationProperties.Repository(
                "ssh://host/special.git", List.of("mvnw", "test"),
                List.of("mvnw", "verify"), "build/jacoco.xml"
        );
        var properties = new AutoUtConfigurationProperties(
                "build/logs", "Java", "Access_智能监控组",
                new AutoUtConfigurationProperties.Repair("pi", "medium", 30, 3),
                new AutoUtConfigurationProperties.Guard(List.of()),
                new AutoUtConfigurationProperties.Scm("codehub-cli", true, "", "", ""),
                template, Map.of("FMInsightService", override)
        );

        var repository = new ConfiguredAutoUtSettings(properties).repository("fminsightservice").orElseThrow();

        assertThat(repository.url()).isEqualTo("ssh://host/special.git");
        assertThat(repository.testCommand()).containsExactly("mvnw", "test");
    }
}
