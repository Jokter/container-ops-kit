package com.jokter.containerops.build.domain.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BuildModuleTest {
    @Test
    void resolvesModuleAndChartPaths() {
        BuildModule module = new BuildModule(
                "mae-access",
                "Chart/{module}",
                "mae-access-base-features-charts/chartTool/charts"
        );

        assertThat(module.archDirectory()).isEqualTo("Chart/mae-access");
        assertThat(module.chartsPath()).isEqualTo("mae-access-base-features-charts/chartTool/charts");
    }

    @Test
    void rejectsPathsThatEscapeTheRepository() {
        assertThatThrownBy(() -> new BuildModule("mae-access", "../{module}", "charts"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
