package com.jokter.containerops.deployment.domain.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DeploymentPreparationTest {
    @Test
    void valuesEditingInvalidatesGeneratedAndRenderedStages() {
        DeploymentPreparation preparation = DeploymentPreparation.create(
                "prep-1",
                1L,
                2L,
                "mae-access",
                "mae",
                List.of("service-a")
        );
        preparation.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));
        preparation.generated("service-a");
        preparation.rendered("service-a", true, null);

        preparation.updateValues("service-a", "changed");

        assertThat(preparation.service("service-a").stage()).isEqualTo(DeploymentStage.ANALYZED);
        assertThat(preparation.revision()).isEqualTo(2L);
    }

    @Test
    void deploymentRequiresLatestSuccessfulRenderAndConfirmation() {
        DeploymentPreparation preparation = DeploymentPreparation.create(
                "prep-1",
                1L,
                2L,
                "mae-access",
                "mae",
                List.of("service-a")
        );

        assertThatThrownBy(() -> preparation.authorizeDeployment(1L, "token"))
                .isInstanceOf(IllegalStateException.class);
    }
}
