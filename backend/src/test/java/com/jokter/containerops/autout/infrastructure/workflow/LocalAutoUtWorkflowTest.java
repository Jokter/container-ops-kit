package com.jokter.containerops.autout.infrastructure.workflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.autout.application.AutoUtRepositoryDefinition;
import com.jokter.containerops.autout.application.AutoUtSettings;
import com.jokter.containerops.autout.domain.model.AutoUtReportItem;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtTaskStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class LocalAutoUtWorkflowTest {
    @TempDir
    Path temporary;

    @Test
    void 手动模式完成单个阶段后暂停() throws Exception {
        Path workspace = temporary.resolve("manual/coder");
        Files.createDirectories(workspace.resolve(".git"));
        RecordingCommands commands = new RecordingCommands(workspace);
        AutoUtRepositoryDefinition repository = repository();
        AutoUtTask task = new AutoUtTask(
                "task-manual",
                new AutoUtReportItem("coder", "Java", "Access_智能监控组", 2, .5, 1, .5, 1),
                "w00789509", "DTS1234", "master_test", "master_test_w00789509_DTS1234",
                temporary.resolve("manual").toString(), AutoUtExecutionMode.MANUAL
        );

        new LocalAutoUtWorkflow(new TestSettings(repository, temporary), commands, piAgent(commands), new ObjectMapper())
                .execute(task, repository, ignored -> {});

        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.WAITING_CONFIRMATION);
        assertThat(task.nextStage().name()).isEqualTo("BASELINE");
        assertThat(commands.labels).doesNotContain("基线测试");
    }

    @Test
    void 只有完整验证和修改门禁通过后才创建CodeHubMergeRequest() throws Exception {
        Path workspace = temporary.resolve("workspaces/coder");
        Files.createDirectories(workspace.resolve(".git"));
        Path testFile = workspace.resolve("src/test/java/SampleTest.java");
        Files.createDirectories(testFile.getParent());
        Files.writeString(testFile, "@Test void sample(){ assertEquals(2, value()); }");
        writeSurefire(workspace, 2, 2, 0);
        writeJacoco(workspace, 10, 0, 4, 0);

        RecordingCommands commands = new RecordingCommands(workspace);
        AutoUtRepositoryDefinition repository = repository();
        AutoUtTask task = new AutoUtTask(
                "task-1",
                new AutoUtReportItem("coder", "Java", "Access_智能监控组", 2, .5, 1, .5, 1),
                "w00789509", "DTS1234", "master_test", "master_test_w00789509_DTS1234",
                temporary.resolve("workspaces").toString(), AutoUtExecutionMode.AUTOMATIC
        );

        new LocalAutoUtWorkflow(new TestSettings(repository, temporary), commands, piAgent(commands), new ObjectMapper())
                .execute(task, repository, ignored -> {});

        assertThat(task.status()).isEqualTo(AutoUtTaskStatus.RESOLVED);
        assertThat(task.pullRequestUrl()).isEqualTo("https://codehub.example.test/org/repo/merge_requests/1");
        assertThat(commands.labels).containsSubsequence("基线测试", "第1轮-Pi", "第1轮-完整验证", "创建CodeHub-MR", "检查CodeHub-MR评审人");
        assertThat(commands.commands).anySatisfy(command -> assertThat(command)
                .containsExactly("codehub-cli", "mr", "upload", "--dest", "master_test", "--br",
                        "master_test_w00789509_DTS1234", "--topic", "master_test_w00789509_DTS1234",
                        "-T", "[DTS1234] 修复 coder 单元测试", "-D",
                        "自动修复 2 个失败单元测试。\n\n完整 UT 与覆盖率验证已通过。",
                        "--reviewers", "u001,u002", "--approvers", "u003", "--assignees", "u004", "-y"));
        assertThat(commands.commands).allSatisfy(command -> assertThat(command).doesNotContain("push"));
        assertThat(commands.commands.stream().filter(command -> command.contains("--mode")).findFirst())
                .hasValueSatisfying(command -> assertThat(command).contains("rpc"));
    }

    private PiAgentPort piAgent(RecordingCommands commands) {
        return (taskId, workspace, prompt, timeout, label) -> commands.run(
                List.of("pi", "--mode", "rpc"), workspace, timeout, taskId, label);
    }

    private AutoUtRepositoryDefinition repository() {
        return new AutoUtRepositoryDefinition(
                "coder", "https://example.test/coder.git",
                List.of("mvn", "test"), List.of("mvn", "verify"), "target/site/jacoco/jacoco.xml"
        );
    }

    private void writeSurefire(Path workspace, int tests, int failures, int skipped) throws Exception {
        Path report = workspace.resolve("target/surefire-reports/TEST-Sample.xml");
        Files.createDirectories(report.getParent());
        String failure = failures == 0 ? "" : "<testcase classname=\"Sample\" name=\"sample\"><failure message=\"失败\">堆栈</failure></testcase>";
        Files.writeString(report, "<testsuite tests=\"" + tests + "\" failures=\"" + failures
                + "\" errors=\"0\" skipped=\"" + skipped + "\">" + failure + "</testsuite>");
    }

    private void writeJacoco(Path workspace, int coveredLines, int missedLines, int coveredBranches, int missedBranches) throws Exception {
        Path report = workspace.resolve("target/site/jacoco/jacoco.xml");
        Files.createDirectories(report.getParent());
        Files.writeString(report, "<?xml version=\"1.0\"?><!DOCTYPE report PUBLIC \"-//JACOCO//DTD Report 1.1//EN\" \"report.dtd\"><report><counter type=\"LINE\" missed=\"" + missedLines + "\" covered=\""
                + coveredLines + "\"/><counter type=\"BRANCH\" missed=\"" + missedBranches + "\" covered=\""
                + coveredBranches + "\"/></report>");
    }

    private final class RecordingCommands implements AutoUtCommandPort {
        private final Path workspace;
        private final List<String> labels = new ArrayList<>();
        private final List<List<String>> commands = new ArrayList<>();

        private RecordingCommands(Path workspace) {
            this.workspace = workspace;
        }

        @Override
        public AutoUtCommandResult run(List<String> command, Path directory, Duration timeout, String taskId, String label) {
            labels.add(label);
            commands.add(List.copyOf(command));
            if (label.equals("检查远端")) return new AutoUtCommandResult(0, "https://example.test/coder.git\n");
            if (label.equals("准备状态")) return new AutoUtCommandResult(0, "");
            if (label.equals("查询本地修复分支") || label.equals("查询远端修复分支")) return new AutoUtCommandResult(1, "");
            if (label.equals("第1轮-Pi")) return new AutoUtCommandResult(0, "完成");
            if (label.equals("第1轮-修改状态") || label.equals("发布前-修改状态")) {
                return new AutoUtCommandResult(0, " M src/test/java/SampleTest.java\n");
            }
            if (label.contains("原始测试")) return new AutoUtCommandResult(0, "@Test void sample(){ assertEquals(1, value()); }");
            if (label.contains("测试差异")) return new AutoUtCommandResult(0, "+@Test void sample(){ assertEquals(2, value()); }");
            if (label.equals("第1轮-完整验证")) {
                try {
                    writeSurefire(workspace, 2, 0, 0);
                } catch (Exception exception) {
                    throw new IllegalStateException(exception);
                }
                return new AutoUtCommandResult(0, "成功");
            }
            if (label.equals("创建CodeHub-MR")) return new AutoUtCommandResult(0,
                    "warning: using inferred project\n{\"id\":1,\"mr_url\":\"https://codehub.example.test/org/repo/merge_requests/1\",\"mode\":\"MR\"}\n");
            if (label.equals("检查CodeHub-MR评审人")) return new AutoUtCommandResult(0,
                    "{\"iid\":1,\"title\":\"UT\",\"approval_merge_request_reviewers\":[],\"approval_merge_request_approvers\":[]}\n");
            return new AutoUtCommandResult(0, "");
        }
    }

    private record TestSettings(AutoUtRepositoryDefinition repository, Path root) implements AutoUtSettings {
        @Override public String language() { return "Java"; }
        @Override public String plGroup() { return "Access_智能监控组"; }
        @Override public Path logDirectory() { return root.resolve("logs"); }
        @Override public String piCommand() { return "pi"; }
        @Override public int piTimeoutSeconds() { return 1800; }
        @Override public int maxAttempts() { return 3; }
        @Override public List<String> forbiddenMarkers() { return List.of("@Disabled", "@Ignore"); }
        @Override public String codeHubCommand() { return "codehub-cli"; }
        @Override public boolean createMergeRequest() { return true; }
        @Override public String codeHubReviewers() { return "u001,u002"; }
        @Override public String codeHubApprovers() { return "u003"; }
        @Override public String codeHubAssignees() { return "u004"; }
        @Override public Optional<AutoUtRepositoryDefinition> repository(String name) { return Optional.of(repository); }
    }
}
