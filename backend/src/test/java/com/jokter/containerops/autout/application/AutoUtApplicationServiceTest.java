package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtReportItem;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtTaskStatus;
import com.jokter.containerops.autout.domain.model.AutoUtRepositoryMapping;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class AutoUtApplicationServiceTest {
    @TempDir
    Path temporary;

    @Test
    void 扫描展示分支计划且执行时明确标记未配置仓库() {
        AutoUtReportParser parser = (content, language, group) -> List.of(
                new AutoUtReportItem("coder", "Java", group, 2, 1, 1, 1, 1),
                new AutoUtReportItem("unknown", "Java", group, 1, .5, .8, .4, .7)
        );
        AutoUtRepositoryDefinition coder = new AutoUtRepositoryDefinition(
                "coder", "https://example.test/coder.git",
                List.of("mvn", "test"), List.of("mvn", "verify"), "target/site/jacoco/jacoco.xml"
        );
        AutoUtSettings settings = new FixedSettings(Map.of("coder", coder));
        AutoUtRepositoryCatalog catalog = new AutoUtRepositoryCatalog(settings, new InMemoryMappings());
        InMemoryTasks tasks = new InMemoryTasks();
        AutoUtWorkflow workflow = (task, repository, checkpoint) -> {
            task.resolve("https://example.test/pull/1");
            checkpoint.accept(task);
        };
        AutoUtApplicationService service = new AutoUtApplicationService(
                parser, settings, catalog, tasks, workflow, Runnable::run);

        var plan = service.scan("report".getBytes(StandardCharsets.UTF_8), "w00789509", "DTS1234", "develop");
        var started = service.start("report".getBytes(StandardCharsets.UTF_8), "w00789509", "DTS1234",
                "develop", temporary.toString(), AutoUtExecutionMode.MANUAL);

        assertThat(plan).extracting(AutoUtPlan::repairBranch)
                .containsExactly("develop_w00789509_DTS1234", "");
        assertThat(plan).extracting(AutoUtPlan::configured).containsExactly(true, false);
        assertThat(started).extracting(AutoUtTask::status)
                .containsExactly(AutoUtTaskStatus.RESOLVED, AutoUtTaskStatus.WAITING_REPOSITORY);
        assertThat(service.findAll()).hasSize(2);
        assertThat(started.getFirst().workspaceRoot()).isEqualTo(temporary.toAbsolutePath().normalize().toString());
    }

    @Test
    void 保存仓库映射后再次扫描使用上次地址() {
        AutoUtReportParser parser = (content, language, group) -> List.of(
                new AutoUtReportItem("FMInsightService", "Java", group, 2, 1, 1, 1, 1));
        AutoUtRepositoryDefinition definition = new AutoUtRepositoryDefinition(
                "fminsightservice", "ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Access/FMInsightService.git",
                List.of("mvn", "test"), List.of("mvn", "verify"), "target/site/jacoco/jacoco.xml");
        AutoUtSettings settings = new FixedSettings(Map.of("fminsightservice", definition));
        InMemoryMappings mappings = new InMemoryMappings();
        AutoUtRepositoryCatalog catalog = new AutoUtRepositoryCatalog(settings, mappings);
        AutoUtApplicationService service = new AutoUtApplicationService(
                parser, settings, catalog, new InMemoryTasks(), (task, repository, checkpoint) -> {}, Runnable::run);

        catalog.save("FMInsightService",
                "ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Special/FMInsightService.git");
        AutoUtPlan plan = service.scan("report".getBytes(StandardCharsets.UTF_8),
                "w00789509", "DTS1234", "develop").getFirst();

        assertThat(plan.repositoryCustomized()).isTrue();
        assertThat(plan.repositoryUrl()).isEqualTo(
                "ssh://git@szv-y.codehub.huawei.com:2222/MAE-M/Special/FMInsightService.git");
    }

    private record FixedSettings(Map<String, AutoUtRepositoryDefinition> repositories) implements AutoUtSettings {
        @Override public String language() { return "Java"; }
        @Override public String plGroup() { return "Access_智能监控组"; }
        @Override public Path logDirectory() { return Path.of("build/auto-ut-logs"); }
        @Override public String piCommand() { return "pi"; }
        @Override public int piTimeoutSeconds() { return 1800; }
        @Override public int maxAttempts() { return 3; }
        @Override public List<String> forbiddenMarkers() { return List.of("@Disabled", "@Ignore"); }
        @Override public String codeHubCommand() { return "codehub-cli"; }
        @Override public boolean createMergeRequest() { return true; }
        @Override public Optional<AutoUtRepositoryDefinition> repository(String name) {
            return Optional.ofNullable(repositories.get(name.toLowerCase()));
        }
    }

    private static final class InMemoryTasks implements AutoUtTaskRepository {
        private final Map<String, AutoUtTask> values = new LinkedHashMap<>();
        @Override public AutoUtTask save(AutoUtTask task) { values.put(task.id(), task); return task; }
        @Override public Optional<AutoUtTask> findById(String id) { return Optional.ofNullable(values.get(id)); }
        @Override public List<AutoUtTask> findAll() { return new ArrayList<>(values.values()); }
    }

    private static final class InMemoryMappings implements AutoUtRepositoryMappingRepository {
        private final Map<String, AutoUtRepositoryMapping> values = new LinkedHashMap<>();
        @Override public Optional<AutoUtRepositoryMapping> find(String repository) {
            return Optional.ofNullable(values.get(repository));
        }
        @Override public AutoUtRepositoryMapping save(AutoUtRepositoryMapping mapping) {
            values.put(mapping.repository(), mapping);
            return mapping;
        }
    }
}
