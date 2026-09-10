package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtReportItem;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtTaskStatus;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

@Service
public class AutoUtApplicationService {
    private final AutoUtReportParser reports;
    private final AutoUtSettings settings;
    private final AutoUtTaskRepository tasks;
    private final AutoUtWorkflow workflow;
    private final Executor executor;

    public AutoUtApplicationService(
            AutoUtReportParser reports,
            AutoUtSettings settings,
            AutoUtTaskRepository tasks,
            AutoUtWorkflow workflow,
            @Qualifier("buildExecutor") Executor executor
    ) {
        this.reports = reports;
        this.settings = settings;
        this.tasks = tasks;
        this.workflow = workflow;
        this.executor = executor;
    }

    public List<AutoUtPlan> scan(byte[] report, String username, String ticket, String baseBranch) {
        validateIdentity(username, ticket);
        validateBranch(baseBranch);
        return reports.parse(report, settings.language(), settings.plGroup()).stream()
                .map(item -> plan(item, username, ticket, baseBranch))
                .toList();
    }

    public List<AutoUtTask> start(
            byte[] report, String username, String ticket, String baseBranch, String workspaceRoot,
            AutoUtExecutionMode executionMode
    ) {
        Path root = validateExecution(username, ticket, baseBranch, workspaceRoot);
        if (executionMode == null) {
            throw new IllegalArgumentException("请选择执行模式");
        }
        List<AutoUtTask> started = reports.parse(report, settings.language(), settings.plGroup()).stream()
                .map(item -> start(item, username, ticket, baseBranch, root, executionMode))
                .toList();
        return started;
    }

    public AutoUtTask continueTask(String id) {
        AutoUtTask task = get(id);
        AutoUtRepositoryDefinition repository = settings.repository(task.repository())
                .orElseThrow(() -> new IllegalStateException("代码仓未配置，任务无法继续。"));
        task.requestContinuation();
        tasks.save(task);
        schedule(task, repository);
        return task;
    }

    public AutoUtTask get(String id) {
        return tasks.findById(id).orElseThrow(AutoUtTaskNotFoundException::new);
    }

    public List<AutoUtTask> findAll() {
        return tasks.findAll().stream()
                .sorted(Comparator.comparing(AutoUtTask::createdAt).reversed())
                .toList();
    }

    public Path validateExecution(String username, String ticket, String baseBranch, String workspaceRoot) {
        validateIdentity(username, ticket);
        validateBranch(baseBranch);
        return validateWorkspace(workspaceRoot);
    }

    private AutoUtPlan plan(AutoUtReportItem item, String username, String ticket, String baseBranch) {
        var repository = settings.repository(item.repository());
        return new AutoUtPlan(
                item.repository(), item.failedTests(), item.lineCoverage(), item.lineGoal(),
                item.branchCoverage(), item.branchGoal(), repository.isPresent(),
                baseBranch,
                repository.map(value -> repairBranch(baseBranch, username, ticket)).orElse("")
        );
    }

    private AutoUtTask start(
            AutoUtReportItem item, String username, String ticket, String baseBranch, Path workspaceRoot,
            AutoUtExecutionMode executionMode
    ) {
        var repository = settings.repository(item.repository());
        AutoUtTask task = new AutoUtTask(
                UUID.randomUUID().toString(), item, username, ticket,
                baseBranch,
                repository.map(value -> repairBranch(baseBranch, username, ticket)).orElse(""),
                workspaceRoot.toString(), executionMode
        );
        if (repository.isEmpty()) {
            task.changeStatus(AutoUtTaskStatus.WAITING_REPOSITORY, "代码仓未配置，任务未执行。");
            tasks.save(task);
            return task;
        }
        tasks.save(task);
        schedule(task, repository.get());
        return task;
    }

    private void schedule(AutoUtTask task, AutoUtRepositoryDefinition repository) {
        CompletableFuture.runAsync(() -> workflow.execute(task, repository, tasks::save), executor)
                .exceptionally(error -> {
                    Throwable cause = error.getCause() == null ? error : error.getCause();
                    task.changeStatus(AutoUtTaskStatus.WAITING_EXTERNAL,
                            cause.getMessage() == null ? "Auto-UT 执行异常" : cause.getMessage());
                    tasks.save(task);
                    return null;
                });
    }

    private Path validateWorkspace(String workspaceRoot) {
        if (workspaceRoot == null || workspaceRoot.isBlank()) {
            throw new IllegalArgumentException("请选择工作目录");
        }
        Path root = Path.of(workspaceRoot).toAbsolutePath().normalize();
        if (!Files.isDirectory(root) || !Files.isWritable(root)) {
            throw new IllegalArgumentException("工作目录不存在或不可写：" + root);
        }
        return root;
    }

    private String repairBranch(String baseBranch, String username, String ticket) {
        return baseBranch + "_" + username + "_" + ticket;
    }

    private void validateIdentity(String username, String ticket) {
        if (username == null || !username.matches("[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("用户名只能包含字母、数字、点、下划线和连字符");
        }
        if (ticket == null || !ticket.matches("[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("单号只能包含字母、数字、点、下划线和连字符");
        }
    }

    private void validateBranch(String baseBranch) {
        if (baseBranch == null || !baseBranch.matches("[A-Za-z0-9._/-]+")
                || baseBranch.startsWith("/") || baseBranch.endsWith("/") || baseBranch.contains("..")) {
            throw new IllegalArgumentException("基础分支格式无效");
        }
    }
}
