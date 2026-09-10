package com.jokter.containerops.autout.domain.model;

public enum AutoUtStage {
    PREPARE(AutoUtTaskStatus.PREPARING, 10, "正在准备独立 Git 工作区。"),
    BASELINE(AutoUtTaskStatus.BASELINE_RUNNING, 25, "正在执行基线 UT。"),
    REPAIR(AutoUtTaskStatus.REPAIRING, 45, "正在执行 Pi 修复。"),
    VERIFY(AutoUtTaskStatus.VERIFYING, 70, "正在执行完整验证。"),
    PUBLISH(AutoUtTaskStatus.PR_CREATING, 90, "正在提交并创建 Pull Request。"),
    DONE(AutoUtTaskStatus.RESOLVED, 100, "任务已完成。");

    private final AutoUtTaskStatus status;
    private final int progress;
    private final String message;

    AutoUtStage(AutoUtTaskStatus status, int progress, String message) {
        this.status = status;
        this.progress = progress;
        this.message = message;
    }

    AutoUtTaskStatus status() { return status; }
    int progress() { return progress; }
    String message() { return message; }
}
