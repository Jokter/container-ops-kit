package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildBranches;
import com.jokter.containerops.build.domain.model.BuildArtifact;
import com.jokter.containerops.build.domain.model.BuildArtifactRepository;
import com.jokter.containerops.build.domain.model.BuildModule;
import com.jokter.containerops.build.domain.model.BuildStep;
import com.jokter.containerops.build.domain.model.BuildStepStatus;
import com.jokter.containerops.build.domain.model.BuildTask;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Qualifier;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
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
        BuildTask task = new BuildTask(
                taskId,
                command.mode(),
                environment.id(),
                environment.name(),
                module.name(),
                command.baseline(),
                command.candidate(),
                steps(command.mode())
        );
        tasks.save(task);
        CompletableFuture.runAsync(() -> execute(task, environment, module, command), buildExecutor);
        return task;
    }

    public BuildTask get(String id) {
        return tasks.findById(id).orElseThrow(BuildTaskNotFoundException::new);
    }

    private void execute(BuildTask task, BuildEnvironment environment, BuildModule module, StartBuildCommand command) {
        task.start();
        tasks.save(task);
        try {
            RemoteTarget target = new RemoteTarget(environment.host(), environment.sshPort(), environment.username(), environment.password());
            String root = normalizedRoot(environment.workDirectory(), task.id());
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
        if (!step(task, target, side, "build-cbb", "构建 CBB-Web-Dev", buildCommand(cbbDirectory))) {
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
}
