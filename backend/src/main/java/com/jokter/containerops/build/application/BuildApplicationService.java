package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildBranches;
import com.jokter.containerops.build.domain.model.BuildArtifact;
import com.jokter.containerops.build.domain.model.BuildArtifactRepository;
import com.jokter.containerops.build.domain.model.BuildModule;
import com.jokter.containerops.build.domain.model.BuildStep;
import com.jokter.containerops.build.domain.model.BuildStepStatus;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTask;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.Comparator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

@Service
public class BuildApplicationService {
    private static final List<String> BRANCH_STEP_NAMES = List.of("prepare", "clone-cbb", "build-cbb", "clone-arch", "build-arch");
    private final BuildTaskRepository tasks;
    private final BuildEnvironmentPort environments;
    private final BuildModuleCatalog modules;
    private final BuildArtifactRepository artifacts;
    private final RemoteCommandPort remoteCommands;
    private final Executor buildExecutor;

    public BuildApplicationService(
            BuildTaskRepository tasks,
            BuildEnvironmentPort environments,
            BuildModuleCatalog modules,
            BuildArtifactRepository artifacts,
            RemoteCommandPort remoteCommands,
            @Qualifier("buildExecutor") Executor buildExecutor
    ) {
        this.tasks = tasks;
        this.environments = environments;
        this.modules = modules;
        this.artifacts = artifacts;
        this.remoteCommands = remoteCommands;
        this.buildExecutor = buildExecutor;
    }

    public BuildTask start(StartBuildCommand command) {
        BuildEnvironment environment = environments.get(command.environmentId());
        BuildModule module = modules.get(command.module());
        String taskId = UUID.randomUUID().toString();
        String workspaceRoot = normalizedRoot(environment.workDirectory(), taskId);
        BuildTask task = new BuildTask(
                taskId,
                command.mode(),
                environment.id(),
                environment.name(),
                module.name(),
                command.baseline(),
                command.candidate(),
                workspaceRoot,
                steps(command.mode())
        );
        tasks.save(task);
        CompletableFuture.runAsync(() -> execute(task, environment, module, command), buildExecutor);
        return task;
    }

    public BuildTask get(String id) {
        return tasks.findById(id).orElseThrow(BuildTaskNotFoundException::new);
    }

    public List<BuildTask> findAll() {
        return tasks.findAll().stream()
                .sorted(Comparator.comparing(BuildTask::createdAt).reversed())
                .toList();
    }

    public List<BuildArtifact> findDeployableArtifacts() {
        return artifacts.findAll().stream()
                .filter(artifact -> tasks.findById(artifact.buildTaskId())
                        .filter(task -> task.mode() == BuildMode.SINGLE && task.status() == BuildStatus.SUCCEEDED)
                        .isPresent())
                .toList();
    }

    @Transactional
    public void delete(String id, boolean deleteWorkspace) {
        BuildTask task = get(id);
        if (!task.status().terminal()) {
            throw new IllegalStateException("运行中的构建任务不能删除");
        }
        if (deleteWorkspace) {
            deleteWorkspace(task);
        }
        artifacts.deleteByBuildTaskId(task.id());
        tasks.deleteById(id);
    }

    public BuildStorageUsage storage(Long environmentId) {
        BuildEnvironment environment = environments.get(environmentId);
        String path = environment.workDirectory();
        if (path == null || path.isBlank()) {
            throw new IllegalStateException("构建环境未配置工作目录");
        }
        path = path.replaceAll("/+$", "");
        String quotedPath = ShellArgument.quote(path);
        RemoteTarget target = new RemoteTarget(environment.host(), environment.sshPort(), environment.username(), environment.password());
        List<String> lines = new ArrayList<>();
        RemoteCommandResult result = remoteCommands.execute(target,
                "du -sk " + quotedPath + " 2>/dev/null | awk '{print \"DU \" $1}'; "
                        + "df -Pk " + quotedPath + " 2>/dev/null | tail -1 | awk '{print \"DF \" $2 \" \" $4 \" \" $5}'", lines::add);
        if (!result.succeeded()) {
            throw new IllegalStateException("无法读取构建工作目录存储占用");
        }
        long used = 0;
        long total = 0;
        long available = 0;
        String usage = "—";
        for (String line : lines) {
            String[] columns = line.trim().split("\\s+");
            if (columns.length >= 2 && columns[0].equals("DU")) {
                used = number(columns[1]) * 1024L;
            }
            if (columns.length >= 4 && columns[0].equals("DF")) {
                total = number(columns[1]) * 1024L;
                available = number(columns[2]) * 1024L;
                usage = columns[3];
            }
        }
        if (used == 0 && total == 0) throw new IllegalStateException(path + " 不存在或不可读取");
        return new BuildStorageUsage(path, used, total, available, usage);
    }

    private void execute(BuildTask task, BuildEnvironment environment, BuildModule module, StartBuildCommand command) {
        task.start();
        tasks.save(task);
        try {
            RemoteTarget target = new RemoteTarget(environment.host(), environment.sshPort(), environment.username(), environment.password());
            String root = task.workspaceRoot();
            boolean successful;
            if (command.mode() == BuildMode.SINGLE) {
                successful = executeBranch(task, target, root + "/single", "single", module, command.baseline());
            } else {
                CompletableFuture<Boolean> baseline = CompletableFuture.supplyAsync(
                        () -> executeBranch(task, target, root + "/baseline", "baseline", module, command.baseline()),
                        buildExecutor
                );
                CompletableFuture<Boolean> candidate = CompletableFuture.supplyAsync(
                        () -> executeBranch(task, target, root + "/candidate", "candidate", module, command.candidate()),
                        buildExecutor
                );
                boolean baselineSuccessful = baseline.join();
                boolean candidateSuccessful = candidate.join();
                successful = baselineSuccessful && candidateSuccessful;
                if (successful) {
                    successful = executeDiff(task, target, root, module);
                }
            }
            if (successful) {
                if (command.mode() == BuildMode.SINGLE) {
                    artifacts.save(BuildArtifact.create(task.id(), environment.id(), module, command.baseline(), root));
                }
                task.succeed();
            } else if (!task.status().terminal()) {
                task.fail("构建失败");
            }
        } catch (Exception exception) {
            task.fail(exception.getMessage() == null ? "构建执行异常" : exception.getMessage());
        }
        tasks.save(task);
    }

    private boolean executeBranch(
            BuildTask task,
            RemoteTarget target,
            String directory,
            String side,
            BuildModule module,
            BuildBranches branches
    ) {
        if (!step(task, target, side, "prepare", "创建远端工作目录", "mkdir -p " + ShellArgument.quote(directory))) {
            return false;
        }
        String cbbDirectory = directory + "/CBB-Web-Dev";
        String archDirectory = directory + "/ArchDesign";
        if (!step(task, target, side, "clone-cbb", "检出 CBB-Web-Dev", cloneCommand(BuildDefinition.CBB_WEB_DEV_REPOSITORY, branches.cbbWebDev().value(), cbbDirectory))) {
            return false;
        }
        if (!step(task, target, side, "build-cbb", "构建 CBB-Web-Dev", buildCommand(cbbDirectory + "/chart-codegen-plugin"))) {
            return false;
        }
        if (!step(task, target, side, "clone-arch", "检出 ArchDesign", cloneCommand(BuildDefinition.ARCH_DESIGN_REPOSITORY, branches.archDesign().value(), archDirectory))) {
            return false;
        }
        return step(task, target, side, "build-arch", "构建 ArchDesign", buildCommand(archDirectory + "/" + module.archDirectory()));
    }

    private boolean executeDiff(BuildTask task, RemoteTarget target, String root, BuildModule module) {
        String stepId = "compare:diff";
        task.startStep(stepId);
        tasks.save(task);
        try {
            String command = "diff -ru --exclude=.git "
                    + ShellArgument.quote(root + "/baseline/ArchDesign/" + module.archDirectory() + "/target/" + module.chartsPath()) + " "
                    + ShellArgument.quote(root + "/candidate/ArchDesign/" + module.archDirectory() + "/target/" + module.chartsPath());
            RemoteCommandResult result = remoteCommands.execute(target, command, line -> {
                task.log(stepId, line);
                tasks.save(task);
            });
            if (result.exitCode() <= 1) {
                task.completeStep(stepId);
                tasks.save(task);
                return true;
            }
            task.failStep(stepId, "产物对比失败，退出码 " + result.exitCode());
            task.fail("产物对比失败");
            tasks.save(task);
            return false;
        } catch (RuntimeException exception) {
            task.failStep(stepId, exception.getMessage() == null ? "产物对比失败" : exception.getMessage());
            task.fail("产物对比失败");
            tasks.save(task);
            return false;
        }
    }

    private boolean step(BuildTask task, RemoteTarget target, String side, String name, String label, String command) {
        String stepId = side + ":" + name;
        task.startStep(stepId);
        tasks.save(task);
        try {
            RemoteCommandResult result = remoteCommands.execute(target, command, line -> {
                task.log(stepId, line);
                tasks.save(task);
            });
            if (result.succeeded()) {
                task.completeStep(stepId);
                tasks.save(task);
                return true;
            }
            task.failStep(stepId, label + "失败，退出码 " + result.exitCode());
            tasks.save(task);
            return false;
        } catch (RuntimeException exception) {
            task.failStep(stepId, exception.getMessage() == null ? label + "失败" : exception.getMessage());
            tasks.save(task);
            return false;
        }
    }

    private List<BuildStep> steps(BuildMode mode) {
        List<BuildStep> result = new ArrayList<>();
        if (mode == BuildMode.SINGLE) {
            addBranchSteps(result, "single", "单分支");
        } else {
            addBranchSteps(result, "baseline", "基准版本 A");
            addBranchSteps(result, "candidate", "验证版本 B");
            result.add(new BuildStep("compare:diff", "对比 ArchDesign 产物", BuildStepStatus.PENDING));
        }
        return result;
    }

    private void addBranchSteps(List<BuildStep> steps, String side, String label) {
        List<String> labels = List.of("准备目录", "检出 CBB-Web-Dev", "构建 CBB-Web-Dev", "检出 ArchDesign", "构建 ArchDesign");
        for (int index = 0; index < BRANCH_STEP_NAMES.size(); index++) {
            steps.add(new BuildStep(side + ":" + BRANCH_STEP_NAMES.get(index), label + " · " + labels.get(index), BuildStepStatus.PENDING));
        }
    }

    private String cloneCommand(String repository, String branch, String directory) {
        return "GIT_TERMINAL_PROMPT=0 git clone --single-branch --branch " + ShellArgument.quote(branch) + " "
                + ShellArgument.quote(repository) + " " + ShellArgument.quote(directory);
    }

    private String buildCommand(String directory) {
        return "cd " + ShellArgument.quote(directory) + " && " + BuildDefinition.BUILD_COMMAND;
    }

    private String normalizedRoot(String workDirectory, String taskId) {
        if (workDirectory == null || workDirectory.isBlank()) {
            throw new IllegalArgumentException("构建环境未配置工作目录");
        }
        return workDirectory.replaceAll("/+$", "") + "/container-ops-kit/builds/" + taskId;
    }

    private void deleteWorkspace(BuildTask task) {
        String expectedSuffix = "/container-ops-kit/builds/" + task.id();
        if (task.workspaceRoot() == null || !task.workspaceRoot().endsWith(expectedSuffix)) {
            throw new IllegalStateException("任务工作目录不合法，拒绝清理");
        }
        BuildEnvironment environment = environments.get(task.environmentId());
        RemoteTarget target = new RemoteTarget(environment.host(), environment.sshPort(), environment.username(), environment.password());
        RemoteCommandResult result = remoteCommands.execute(target,
                "rm -rf -- " + ShellArgument.quote(task.workspaceRoot()), ignored -> { });
        if (!result.succeeded()) {
            throw new IllegalStateException("远端构建目录清理失败");
        }
    }

    private long number(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException exception) {
            return 0;
        }
    }
}
