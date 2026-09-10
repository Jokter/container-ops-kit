package com.jokter.containerops.autout.domain.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class AutoUtTask {
    private final String id;
    private final String repository;
    private final String username;
    private final String ticket;
    private final String baseBranch;
    private final String repairBranch;
    private final int reportedFailedTests;
    private final double lineGoal;
    private final double branchGoal;
    private final String workspaceRoot;
    private final AutoUtExecutionMode executionMode;
    private final Instant createdAt;
    private final List<AutoUtTaskEvent> history;
    private AutoUtTaskStatus status;
    private AutoUtStage nextStage;
    private int progress;
    private int attempts;
    private String message;
    private String pullRequestUrl;
    private Instant updatedAt;

    public AutoUtTask(
            String id, AutoUtReportItem item, String username, String ticket,
            String baseBranch, String repairBranch, String workspaceRoot,
            AutoUtExecutionMode executionMode
    ) {
        this(id, item.repository(), username, ticket, baseBranch, repairBranch, item.failedTests(),
                item.lineGoal(), item.branchGoal(), workspaceRoot, executionMode,
                AutoUtTaskStatus.DISCOVERED, AutoUtStage.PREPARE, 0, 0,
                "已发现待修复任务", "", Instant.now(), Instant.now(), new ArrayList<>());
        changeStatus(AutoUtTaskStatus.DISCOVERED, "已发现待修复任务");
    }

    public static AutoUtTask restore(
            String id, String repository, String username, String ticket, String baseBranch,
            String repairBranch, int reportedFailedTests, double lineGoal, double branchGoal,
            String workspaceRoot, AutoUtExecutionMode executionMode, AutoUtTaskStatus status,
            AutoUtStage nextStage, int progress, int attempts, String message, String pullRequestUrl,
            Instant createdAt, Instant updatedAt, List<AutoUtTaskEvent> history
    ) {
        return new AutoUtTask(id, repository, username, ticket, baseBranch, repairBranch,
                reportedFailedTests, lineGoal, branchGoal, workspaceRoot, executionMode,
                status, nextStage, progress, attempts, message,
                pullRequestUrl, createdAt, updatedAt, new ArrayList<>(history));
    }

    private AutoUtTask(
            String id, String repository, String username, String ticket, String baseBranch,
            String repairBranch, int reportedFailedTests, double lineGoal, double branchGoal,
            String workspaceRoot, AutoUtExecutionMode executionMode, AutoUtTaskStatus status,
            AutoUtStage nextStage, int progress, int attempts, String message, String pullRequestUrl,
            Instant createdAt, Instant updatedAt, List<AutoUtTaskEvent> history
    ) {
        this.id = id;
        this.repository = repository;
        this.username = username;
        this.ticket = ticket;
        this.baseBranch = baseBranch;
        this.repairBranch = repairBranch;
        this.reportedFailedTests = reportedFailedTests;
        this.lineGoal = lineGoal;
        this.branchGoal = branchGoal;
        this.workspaceRoot = workspaceRoot;
        this.executionMode = executionMode;
        this.status = status;
        this.nextStage = nextStage;
        this.progress = progress;
        this.attempts = attempts;
        this.message = message;
        this.pullRequestUrl = pullRequestUrl;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.history = history;
    }

    public synchronized void changeStatus(AutoUtTaskStatus status, String message) {
        this.status = status;
        this.message = message;
        this.updatedAt = Instant.now();
        this.history.add(new AutoUtTaskEvent(updatedAt, status, message));
    }

    public synchronized boolean claimNextStage() {
        if (nextStage == AutoUtStage.DONE
                || status != AutoUtTaskStatus.DISCOVERED
                && status != AutoUtTaskStatus.WAITING_CONFIRMATION) {
            return false;
        }
        AutoUtStage claimedStage = nextStage;
        if (claimedStage == AutoUtStage.REPAIR) {
            attempts++;
        }
        progress = Math.max(progress, claimedStage.progress());
        changeStatus(claimedStage.status(), claimedStage.message());
        return true;
    }

    public synchronized void waitFor(AutoUtStage stage, String message, int progress) {
        nextStage = stage;
        this.progress = Math.max(this.progress, progress);
        changeStatus(AutoUtTaskStatus.WAITING_CONFIRMATION, message);
    }

    public synchronized void requestContinuation() {
        boolean manualContinuation = executionMode == AutoUtExecutionMode.MANUAL
                && status == AutoUtTaskStatus.WAITING_CONFIRMATION;
        if (!manualContinuation && status != AutoUtTaskStatus.WAITING_EXTERNAL) {
            throw new IllegalStateException("当前任务不处于可继续或重试的阶段。");
        }
        changeStatus(AutoUtTaskStatus.DISCOVERED, "下一阶段已进入执行队列：" + nextStage.message());
    }

    public synchronized void record(String message) {
        changeStatus(status, message);
    }

    public synchronized void resolve(String pullRequestUrl) {
        this.pullRequestUrl = pullRequestUrl;
        this.nextStage = AutoUtStage.DONE;
        this.progress = 100;
        changeStatus(AutoUtTaskStatus.RESOLVED, "修复验证通过且 Pull Request 已创建。");
    }

    public String id() { return id; }
    public String repository() { return repository; }
    public String username() { return username; }
    public String ticket() { return ticket; }
    public String baseBranch() { return baseBranch; }
    public String repairBranch() { return repairBranch; }
    public int reportedFailedTests() { return reportedFailedTests; }
    public double lineGoal() { return lineGoal; }
    public double branchGoal() { return branchGoal; }
    public String workspaceRoot() { return workspaceRoot; }
    public AutoUtExecutionMode executionMode() { return executionMode; }
    public synchronized AutoUtTaskStatus status() { return status; }
    public synchronized AutoUtStage nextStage() { return nextStage; }
    public synchronized int progress() { return progress; }
    public synchronized int attempts() { return attempts; }
    public synchronized String message() { return message; }
    public synchronized String pullRequestUrl() { return pullRequestUrl; }
    public Instant createdAt() { return createdAt; }
    public synchronized Instant updatedAt() { return updatedAt; }
    public synchronized List<AutoUtTaskEvent> history() { return List.copyOf(history); }
}
