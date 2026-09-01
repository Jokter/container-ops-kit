package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildBranches;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTask;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import com.jokter.containerops.build.domain.model.BuildArtifact;
import com.jokter.containerops.build.domain.model.BuildArtifactRepository;
import com.jokter.containerops.build.domain.model.BuildModule;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class BuildApplicationServiceTest {
    private static final BuildEnvironment ENVIRONMENT = new BuildEnvironment(
            9L,
            "构建环境",
            "10.0.0.8",
            22,
            "huawei",
            "password",
            "/data/builds"
    );

    @Test
    void singleBuildUsesFixedRepositoriesCommandAndUserBranches() {
        InMemoryTasks tasks = new InMemoryTasks();
        RecordingRemoteCommands remote = new RecordingRemoteCommands();
        BuildApplicationService service = service(tasks, remote);

        BuildTask task = service.start(new StartBuildCommand(
                BuildMode.SINGLE,
                9L,
                "mae-access",
                new BuildBranches("release/cbb", "feature/arch"),
                null
        ));

        assertThat(task.status()).isEqualTo(BuildStatus.SUCCEEDED);
        assertThat(remote.commands).anyMatch(command -> command.contains(BuildDefinition.CBB_WEB_DEV_REPOSITORY) && command.contains("release/cbb"));
        assertThat(remote.commands).anyMatch(command -> command.contains(BuildDefinition.ARCH_DESIGN_REPOSITORY) && command.contains("feature/arch"));
        assertThat(remote.commands).filteredOn(command -> command.contains("mvn clean install")).allMatch(command -> command.contains(BuildDefinition.BUILD_COMMAND));
        assertThat(remote.commands).anyMatch(command -> command.contains("single/CBB-Web-Dev/chart-codegen-plugin") && command.contains(BuildDefinition.BUILD_COMMAND));
        assertThat(remote.commands).anyMatch(command -> command.contains("ArchDesign/Chart/mae-access"));
    }

    @Test
    void compareBuildRunsBothSidesAndDiffsOnlyAfterBothSucceed() {
        InMemoryTasks tasks = new InMemoryTasks();
        RecordingRemoteCommands remote = new RecordingRemoteCommands();
        BuildApplicationService service = service(tasks, remote);

        BuildTask task = service.start(new StartBuildCommand(
                BuildMode.COMPARE,
                9L,
                "mae-access",
                new BuildBranches("master", "baseline"),
                new BuildBranches("feature/cbb", "candidate")
        ));

        assertThat(task.status()).isEqualTo(BuildStatus.SUCCEEDED);
        assertThat(remote.commands).anyMatch(command -> command.contains("baseline/CBB-Web-Dev/chart-codegen-plugin") && command.contains(BuildDefinition.BUILD_COMMAND));
        assertThat(remote.commands).anyMatch(command -> command.contains("candidate/CBB-Web-Dev/chart-codegen-plugin") && command.contains(BuildDefinition.BUILD_COMMAND));
        assertThat(remote.commands).anyMatch(command -> command.startsWith("diff -ru"));
    }

    @Test
    void compareBuildFailsWithoutDiffWhenEitherSideFails() {
        InMemoryTasks tasks = new InMemoryTasks();
        RecordingRemoteCommands remote = new RecordingRemoteCommands();
        remote.exitCodes.put("feature/broken", 1);
        BuildApplicationService service = service(tasks, remote);

        BuildTask task = service.start(new StartBuildCommand(
                BuildMode.COMPARE,
                9L,
                "mae-access",
                new BuildBranches("master", "master"),
                new BuildBranches("feature/broken", "master")
        ));

        assertThat(task.status()).isEqualTo(BuildStatus.FAILED);
        assertThat(remote.commands).noneMatch(command -> command.startsWith("diff -ru"));
    }

    @Test
    void completedTasksCanBeListedAndDeletedWithoutRemovingWorkspace() {
        InMemoryTasks tasks = new InMemoryTasks();
        RecordingRemoteCommands remote = new RecordingRemoteCommands();
        BuildApplicationService service = service(tasks, remote);
        BuildTask task = service.start(new StartBuildCommand(
                BuildMode.SINGLE, 9L, "mae-access", new BuildBranches("master", "master"), null));

        assertThat(service.findAll()).extracting(BuildTask::id).containsExactly(task.id());
        service.delete(task.id(), false);

        assertThat(service.findAll()).isEmpty();
        assertThat(remote.commands).noneMatch(command -> command.startsWith("rm -rf"));
    }

    @Test
    void storageReadsUserWytestUsageFromBuildEnvironment() {
        InMemoryTasks tasks = new InMemoryTasks();
        RecordingRemoteCommands remote = new RecordingRemoteCommands();
        BuildApplicationService service = service(tasks, remote);

        BuildStorageUsage usage = service.storage(9L);

        assertThat(usage.path()).isEqualTo("/user/wytest");
        assertThat(usage.usedBytes()).isEqualTo(1024L * 1024L);
        assertThat(usage.availableBytes()).isEqualTo(8L * 1024L * 1024L);
        assertThat(usage.filesystemUsage()).isEqualTo("20%");
    }

    private BuildApplicationService service(InMemoryTasks tasks, RecordingRemoteCommands remote) {
        BuildEnvironmentPort environments = id -> ENVIRONMENT;
        BuildModule module = new BuildModule("mae-access", "Chart/{module}", "mae-access-base-features-charts/chartTool/charts");
        BuildModuleCatalog modules = new BuildModuleCatalog() {
            public List<BuildModule> findAll() { return List.of(module); }
            public BuildModule get(String name) { return module; }
        };
        BuildArtifactRepository artifacts = new BuildArtifactRepository() {
            public BuildArtifact save(BuildArtifact artifact) { return artifact; }
            public List<BuildArtifact> findAll() { return List.of(); }
            public Optional<BuildArtifact> findById(Long id) { return Optional.empty(); }
        };
        Executor direct = Runnable::run;
        return new BuildApplicationService(tasks, environments, modules, artifacts, remote, direct);
    }

    private static final class InMemoryTasks implements BuildTaskRepository {
        private final Map<String, BuildTask> tasks = new LinkedHashMap<>();

        @Override
        public void save(BuildTask task) {
            tasks.put(task.id(), task);
        }

        @Override
        public Optional<BuildTask> findById(String id) {
            return Optional.ofNullable(tasks.get(id));
        }

        @Override
        public List<BuildTask> findAll() {
            return List.copyOf(tasks.values());
        }

        @Override
        public void deleteById(String id) {
            tasks.remove(id);
        }
    }

    private static final class RecordingRemoteCommands implements RemoteCommandPort {
        private final List<String> commands = new ArrayList<>();
        private final Map<String, Integer> exitCodes = new LinkedHashMap<>();

        @Override
        public RemoteCommandResult execute(RemoteTarget target, String command, Consumer<String> output) {
            commands.add(command);
            if (command.contains("du -sk /user/wytest")) {
                output.accept("DU 1024");
                output.accept("DF 10240 8192 20%");
                return new RemoteCommandResult(0);
            }
            output.accept("executed");
            int exitCode = exitCodes.entrySet().stream()
                    .filter(entry -> command.contains(entry.getKey()))
                    .map(Map.Entry::getValue)
                    .findFirst()
                    .orElse(0);
            return new RemoteCommandResult(exitCode);
        }
    }
}
