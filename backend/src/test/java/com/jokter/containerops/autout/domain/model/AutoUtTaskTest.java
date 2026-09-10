package com.jokter.containerops.autout.domain.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AutoUtTaskTest {
    @Test
    void 手动任务逐阶段推进且进度不会倒退() {
        AutoUtTask task = new AutoUtTask(
                "task-1",
                new AutoUtReportItem("coder", "Java", "Access_智能监控组", 2, .8, 1, .7, 1),
                "w00789509", "DTS1234", "master_test", "master_test_w00789509_DTS1234",
                "E:\\AutoUT", AutoUtExecutionMode.MANUAL
        );

        assertThat(task.claimNextStage()).isTrue();
        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.PREPARING);
        assertThat(task.progress()).isEqualTo(10);

        task.waitFor(AutoUtStage.BASELINE, "工作区准备完成", 20);

        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.WAITING_CONFIRMATION);
        assertThat(task.nextStage()).isEqualTo(AutoUtStage.BASELINE);
        assertThat(task.progress()).isEqualTo(20);
        task.requestContinuation();
        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.DISCOVERED);
        assertThat(task.claimNextStage()).isTrue();
        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.BASELINE_RUNNING);
        assertThat(task.progress()).isEqualTo(25);
    }

    @Test
    void 外部错误处理后可以重试当前阶段() {
        AutoUtTask task = new AutoUtTask(
                "task-1",
                new AutoUtReportItem("coder", "Java", "Access_智能监控组", 2, .8, 1, .7, 1),
                "w00789509", "DTS1234", "master_test", "master_test_w00789509_DTS1234",
                "E:\\AutoUT", AutoUtExecutionMode.MANUAL
        );
        task.claimNextStage();
        task.waitFor(AutoUtStage.BASELINE, "工作区准备完成", 20);
        task.requestContinuation();
        task.claimNextStage();
        task.changeStatus(AutoUtTaskStatus.WAITING_EXTERNAL, "无法执行 mvn");

        task.requestContinuation();

        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.DISCOVERED);
        assertThat(task.nextStage()).isEqualTo(AutoUtStage.BASELINE);
    }
}
