package com.jokter.containerops.build.domain.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class BuildTask {
    private static final int MAX_EVENTS = 10000;
    private final String id;
    private final BuildMode mode;
    private final Long environmentId;
    private final String environmentName;
    private final String module;
    private final BuildBranches baseline;
    private final BuildBranches candidate;
    private final Instant createdAt;
    private final List<BuildStep> steps;
    private final List<BuildEvent> events = new ArrayList<>();
    private BuildStatus status = BuildStatus.PENDING;
    private Instant startedAt;
    private Instant finishedAt;
    private String error;
    private int completedSteps;
    private long sequence;

    public BuildTask(
            String id,
            BuildMode mode,
            Long environmentId,
            String environmentName,
            String module,
            BuildBranches baseline,
            BuildBranches candidate,
            List<BuildStep> steps
    ) {
        if (baseline == null || mode == BuildMode.COMPARE && candidate == null) {
            throw new IllegalArgumentException("构建分支不能为空");
        }
        this.id = id;
        this.mode = mode;
        this.environmentId = environmentId;
        this.environmentName = environmentName;
        this.module = module;
        this.baseline = baseline;
        this.candidate = candidate;
        this.steps = new ArrayList<>(steps);
        this.createdAt = Instant.now();
        event(BuildEventType.TASK, null, "构建任务已创建");
    }

    public synchronized void start() {
        status = BuildStatus.RUNNING;
        startedAt = Instant.now();
        event(BuildEventType.TASK, null, "构建任务开始执行");
    }

    public synchronized void startStep(String stepId) {
        replaceStep(stepId, BuildStepStatus.RUNNING);
        event(BuildEventType.STEP, stepId, step(stepId).label() + "开始");
    }

    public synchronized void log(String stepId, String line) {
        if (line != null && !line.isBlank()) {
            event(BuildEventType.LOG, stepId, line);
        }
    }

    public synchronized void completeStep(String stepId) {
        replaceStep(stepId, BuildStepStatus.SUCCEEDED);
        completedSteps++;
        event(BuildEventType.STEP, stepId, step(stepId).label() + "完成");
    }

    public synchronized void failStep(String stepId, String reason) {
        replaceStep(stepId, BuildStepStatus.FAILED);
        event(BuildEventType.STEP, stepId, reason);
    }

    public synchronized void succeed() {
        status = BuildStatus.SUCCEEDED;
        finishedAt = Instant.now();
        event(BuildEventType.TASK, null, "构建任务执行成功");
    }

    public synchronized void fail(String reason) {
        status = BuildStatus.FAILED;
        error = reason;
        finishedAt = Instant.now();
        for (int index = 0; index < steps.size(); index++) {
            BuildStep step = steps.get(index);
            if (step.status() == BuildStepStatus.PENDING) {
                steps.set(index, step.withStatus(BuildStepStatus.SKIPPED));
            }
        }
        event(BuildEventType.TASK, null, reason);
    }

    private void replaceStep(String stepId, BuildStepStatus next) {
        for (int index = 0; index < steps.size(); index++) {
            if (steps.get(index).id().equals(stepId)) {
                steps.set(index, steps.get(index).withStatus(next));
                return;
            }
        }
        throw new IllegalArgumentException("构建步骤不存在");
    }

    private BuildStep step(String stepId) {
        return steps.stream().filter(item -> item.id().equals(stepId)).findFirst().orElseThrow();
    }

    private void event(BuildEventType type, String stepId, String message) {
        int progress = steps.isEmpty() ? 0 : Math.min(100, completedSteps * 100 / steps.size());
        events.add(new BuildEvent(++sequence, Instant.now(), type, stepId, message, progress, status));
        while (events.size() > MAX_EVENTS) {
            int removable = -1;
            for (int index = 0; index < events.size(); index++) {
                if (events.get(index).type() == BuildEventType.LOG) {
                    removable = index;
                    break;
                }
            }
            if (removable < 0) {
                break;
            }
            events.remove(removable);
        }
    }

    public String id() { return id; }
    public BuildMode mode() { return mode; }
    public Long environmentId() { return environmentId; }
    public String environmentName() { return environmentName; }
    public String module() { return module; }
    public BuildBranches baseline() { return baseline; }
    public BuildBranches candidate() { return candidate; }
    public synchronized BuildStatus status() { return status; }
    public Instant createdAt() { return createdAt; }
    public synchronized Instant startedAt() { return startedAt; }
    public synchronized Instant finishedAt() { return finishedAt; }
    public synchronized String error() { return error; }
    public synchronized int progress() { return steps.isEmpty() ? 0 : Math.min(100, completedSteps * 100 / steps.size()); }
    public synchronized List<BuildStep> steps() { return List.copyOf(steps); }
    public synchronized List<BuildEvent> events() { return List.copyOf(events); }
}
