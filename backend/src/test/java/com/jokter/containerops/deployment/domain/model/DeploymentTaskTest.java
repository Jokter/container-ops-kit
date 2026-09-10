package com.jokter.containerops.deployment.domain.model;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DeploymentTaskTest {
    @Test
    void taskStartsPendingAndExplicitlyBeginsAnalysis() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));

        assertThat(task.status()).isEqualTo(DeploymentTaskStatus.PENDING);

        task.beginAnalysis();

        assertThat(task.status()).isEqualTo(DeploymentTaskStatus.ANALYZING);
    }

    @Test
    void valuesEditingInvalidatesGeneratedAndRenderedStages() {
        DeploymentTask preparation = DeploymentTask.create(
                "prep-1",
                DeploymentMode.REVIEW,
                1L,
                2L,
                "mae-access",
                "mae",
                List.of("service-a")
        );
        preparation.beginAnalysis();
        preparation.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));
        preparation.generated("service-a");
        preparation.rendered("service-a", true, null);

        preparation.updateValues("service-a", "changed");

        assertThat(preparation.service("service-a").stage()).isEqualTo(DeploymentStage.ANALYZED);
        assertThat(preparation.revision()).isEqualTo(2L);
    }

    @Test
    void reviewDeploymentRequiresLatestRevision() {
        DeploymentTask preparation = DeploymentTask.create(
                "prep-1",
                DeploymentMode.REVIEW,
                1L,
                2L,
                "mae-access",
                "mae",
                List.of("service-a")
        );

        preparation.beginAnalysis();
        preparation.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));
        preparation.updateValues("service-a", "changed");

        assertThat(preparation.status()).isEqualTo(DeploymentTaskStatus.AWAITING_REVIEW);
        assertThatThrownBy(() -> preparation.beginReviewedExecution(1L))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void quickDeploymentStartsAutomaticallyAndCannotBeEdited() {
        DeploymentTask preparation = DeploymentTask.create(
                "prep-1",
                DeploymentMode.QUICK,
                1L,
                2L,
                "mae-access",
                "mae",
                List.of("service-a")
        );
        preparation.beginAnalysis();
        preparation.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));

        preparation.beginAutomaticExecution();

        assertThat(preparation.status()).isEqualTo(DeploymentTaskStatus.PREPARING);
        assertThatThrownBy(() -> preparation.updateValues("service-a", "changed"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> preparation.beginAutomaticExecution())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void multiServiceTaskRemainsDeployingUntilEveryServiceFinishes() {
        DeploymentTask preparation = DeploymentTask.create(
                "prep-1", DeploymentMode.QUICK, 1L, 2L, "mae-access", "mae", List.of("service-a", "service-b"));
        preparation.beginAnalysis();
        preparation.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));
        preparation.analyzed("service-b", PreparedService.success("service-b", "values", "chart"));
        preparation.beginAutomaticExecution();
        for (String service : List.of("service-a", "service-b")) {
            preparation.generated(service);
            preparation.rendered(service, true, null);
        }
        preparation.beginDeployment();
        preparation.deploying("service-a");
        preparation.deployed("service-a", false, "failed");

        assertThat(preparation.status()).isEqualTo(DeploymentTaskStatus.DEPLOYING);

        preparation.deploying("service-b");
        preparation.deployed("service-b", true, null);
        preparation.finishExecution();

        assertThat(preparation.status()).isEqualTo(DeploymentTaskStatus.FAILED);
    }

    @Test
    void repeatedReviewedExecutionWithTheSameRevisionIsIdempotent() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", PreparedService.success("service-a", "values", "chart"));

        assertThat(task.beginReviewedExecution(1L)).isTrue();
        assertThat(task.beginReviewedExecution(1L)).isFalse();
    }

    @Test
    void quickDeploymentStopsWhenImageVersionIsUnresolved() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.QUICK, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", new PreparedService(
                "service-a", "image: demo:{version:demo}", "chart", Map.of(), List.of(), Set.of("demo"), List.of()));

        assertThat(task.status()).isEqualTo(DeploymentTaskStatus.FAILED);
        assertThatThrownBy(task::beginAutomaticExecution).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void reviewDeploymentCanResolveImageVersionByEditingValues() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", new PreparedService(
                "service-a", "image: demo:{version:demo}", "chart", Map.of(), List.of(), Set.of("demo"), List.of()));

        assertThat(task.status()).isEqualTo(DeploymentTaskStatus.AWAITING_REVIEW);
        assertThatThrownBy(() -> task.beginReviewedExecution(1L)).isInstanceOf(IllegalStateException.class);

        task.updateValues("service-a", "image: demo:1.0.0");

        assertThat(task.service("service-a").unresolvedImages()).isEmpty();
        assertThat(task.beginReviewedExecution(2L)).isTrue();
        assertThat(task.startedAt()).isNotNull();
        assertThat(task.createdAt()).isNotNull();
    }

    @Test
    void reviewDeploymentCanRepairAnUnresolvedImageReportedByAnalysis() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", new PreparedService(
                "service-a",
                "image: demo:{version:demo}",
                "chart",
                Map.of(),
                List.of(),
                Set.of("demo"),
                List.of()
        ));

        assertThat(task.status()).isEqualTo(DeploymentTaskStatus.AWAITING_REVIEW);

        task.updateValues("service-a", "image: demo:1.0.0");

        assertThat(task.beginReviewedExecution(2L)).isTrue();
    }

    @Test
    void reviewDeploymentRejectsAnUnresolvedImageIntroducedByEditingValues() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", PreparedService.success("service-a", "image: demo:1.0.0", "chart"));

        task.updateValues("service-a", "image: demo:{version:new-image}");

        assertThat(task.service("service-a").unresolvedImages()).containsExactly("new-image");
        assertThatThrownBy(() -> task.beginReviewedExecution(2L)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void reviewDeploymentRejectsOtherPlaceholdersIntroducedByEditingValues() {
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-access", "mae", List.of("service-a"));
        task.beginAnalysis();
        task.analyzed("service-a", PreparedService.success("service-a", "value: ready", "chart"));

        task.updateValues("service-a", "secret: {missing}\nasset: replaceByOssDiy");

        assertThatThrownBy(() -> task.beginReviewedExecution(2L)).isInstanceOf(IllegalStateException.class);
    }
}
