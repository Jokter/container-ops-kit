package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtReportItem;
import com.jokter.containerops.autout.domain.model.AutoUtSchedule;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtRepositoryMapping;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class AutoUtScheduleServiceTest {
    @TempDir
    Path temporary;

    @Test
    void 每日到点只创建一次自动任务() {
        InMemoryTasks tasks = new InMemoryTasks();
        AutoUtReportParser parser = (content, language, group) -> List.of(
                new AutoUtReportItem("unknown", "Java", group, 1, .8, 1, .7, 1));
        FixedSettings settings = new FixedSettings();
        AutoUtApplicationService autoUt = new AutoUtApplicationService(
                parser, settings, new AutoUtRepositoryCatalog(settings, new InMemoryMappings()),
                tasks, (task, repository, checkpoint) -> {}, Runnable::run);
        InMemorySchedules schedules = new InMemorySchedules();
        Clock clock = Clock.fixed(Instant.parse("2026-09-11T00:30:00Z"), ZoneId.of("Asia/Shanghai"));
        AutoUtScheduleService service = new AutoUtScheduleService(schedules, autoUt, clock);

        service.save("report.csv", "报告".getBytes(StandardCharsets.UTF_8),
                "user1", "DTS1", "develop", temporary.toString(), "08:30");
        service.triggerDue();
        service.triggerDue();

        assertThat(tasks.findAll()).hasSize(1);
        assertThat(tasks.findAll().getFirst().executionMode().name()).isEqualTo("AUTOMATIC");
        assertThat(service.get().orElseThrow().lastTriggeredOn()).isEqualTo(LocalDate.of(2026, 9, 11));
    }

    private static final class InMemorySchedules implements AutoUtScheduleRepository {
        private AutoUtSchedule value;
        @Override public AutoUtSchedule save(AutoUtSchedule schedule) { value = schedule; return schedule; }
        @Override public Optional<AutoUtSchedule> find() { return Optional.ofNullable(value); }
        @Override public void delete() { value = null; }
    }

    private static final class InMemoryTasks implements AutoUtTaskRepository {
        private final Map<String, AutoUtTask> values = new LinkedHashMap<>();
        @Override public AutoUtTask save(AutoUtTask task) { values.put(task.id(), task); return task; }
        @Override public Optional<AutoUtTask> findById(String id) { return Optional.ofNullable(values.get(id)); }
        @Override public List<AutoUtTask> findAll() { return new ArrayList<>(values.values()); }
    }

    private static final class InMemoryMappings implements AutoUtRepositoryMappingRepository {
        @Override public Optional<AutoUtRepositoryMapping> find(String repository) { return Optional.empty(); }
        @Override public AutoUtRepositoryMapping save(AutoUtRepositoryMapping mapping) { return mapping; }
    }

    private static final class FixedSettings implements AutoUtSettings {
        @Override public String language() { return "Java"; }
        @Override public String plGroup() { return "Access_智能监控组"; }
        @Override public Path logDirectory() { return Path.of("build/auto-ut-logs"); }
        @Override public String piCommand() { return "pi"; }
        @Override public int piTimeoutSeconds() { return 1800; }
        @Override public int maxAttempts() { return 3; }
        @Override public List<String> forbiddenMarkers() { return List.of("@Disabled", "@Ignore"); }
        @Override public String codeHubCommand() { return "codehub-cli"; }
        @Override public boolean createMergeRequest() { return true; }
        @Override public Optional<AutoUtRepositoryDefinition> repository(String name) { return Optional.empty(); }
    }
}
