package com.jokter.containerops.autout.infrastructure.workflow;

import com.jokter.containerops.autout.application.AutoUtRepositoryDefinition;
import com.jokter.containerops.autout.application.AutoUtSettings;
import com.jokter.containerops.autout.application.AutoUtWorkflow;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtStage;
import com.jokter.containerops.autout.domain.model.AutoUtTaskStatus;
import org.springframework.stereotype.Component;
import org.w3c.dom.Element;

import javax.xml.parsers.DocumentBuilderFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Component
public class LocalAutoUtWorkflow implements AutoUtWorkflow {
    private static final Duration SHORT_COMMAND = Duration.ofSeconds(120);
    private static final Duration NETWORK_COMMAND = Duration.ofMinutes(10);
    private static final Duration TEST_COMMAND = Duration.ofMinutes(30);
    private static final Pattern ASSERTION = Pattern.compile("\\bassert[A-Z]\\w*\\s*\\(");
    private static final Pattern TRIVIAL_ASSERTION = Pattern.compile("assertTrue\\s*\\(\\s*true\\s*\\)|assertFalse\\s*\\(\\s*false\\s*\\)");
    private final AutoUtSettings settings;
    private final AutoUtCommandPort commands;

    public LocalAutoUtWorkflow(AutoUtSettings settings, AutoUtCommandPort commands) {
        this.settings = settings;
        this.commands = commands;
    }

    @Override
    public void execute(AutoUtTask task, AutoUtRepositoryDefinition repository, Consumer<AutoUtTask> checkpoint) {
        Path root = Path.of(task.workspaceRoot()).toAbsolutePath().normalize();
        Path workspace = root
                .resolve(repository.name().toLowerCase(Locale.ROOT)).normalize();
        if (!workspace.startsWith(root)) {
            throw new IllegalArgumentException("服务工作目录越界：" + workspace);
        }
        try {
            do {
                AutoUtStage stage = task.nextStage();
                if (!task.claimNextStage()) return;
                checkpoint.accept(task);
                if (stage == AutoUtStage.PREPARE) {
                    prepare(task, repository, workspace);
                    task.waitFor(AutoUtStage.BASELINE, "工作区准备完成：" + workspace, 20);
                } else if (stage == AutoUtStage.BASELINE) {
                    TestEvidence baseline = baseline(task, repository, workspace);
                    task.record("基线 UT：共 " + baseline.tests() + "，失败 " + baseline.failedCount() + "，跳过 " + baseline.skipped());
                    if (baseline.failedCount() != task.reportedFailedTests()) {
                        task.changeStatus(AutoUtTaskStatus.WAITING_EXTERNAL,
                                "报告显示失败 UT " + task.reportedFailedTests() + " 个，但本地基线识别到 " + baseline.failedCount() + " 个。");
                    } else {
                        checkoutRepairBranch(task, workspace);
                        task.waitFor(AutoUtStage.REPAIR, "基线确认完成，修复分支已就绪。", 35);
                    }
                } else if (stage == AutoUtStage.REPAIR) {
                    repair(task, workspace);
                } else if (stage == AutoUtStage.VERIFY) {
                    verify(task, repository, workspace);
                } else if (stage == AutoUtStage.PUBLISH) {
                    publish(task, repository, workspace);
                }
                checkpoint.accept(task);
            } while (task.executionMode() == AutoUtExecutionMode.AUTOMATIC
                    && task.status() == AutoUtTaskStatus.WAITING_CONFIRMATION);
        } catch (RuntimeException exception) {
            task.changeStatus(AutoUtTaskStatus.WAITING_EXTERNAL,
                    exception.getMessage() == null ? "Auto-UT 执行异常" : exception.getMessage());
            checkpoint.accept(task);
        }
    }

    private void prepare(AutoUtTask task, AutoUtRepositoryDefinition repository, Path workspace) {
        try {
            Files.createDirectories(workspace.getParent());
        } catch (Exception exception) {
            throw new IllegalStateException("无法创建工作目录：" + workspace.getParent(), exception);
        }
        if (Files.exists(workspace)) {
            required(List.of("git", "rev-parse", "--git-dir"), workspace, SHORT_COMMAND, task, "检查Git仓库");
            String origin = required(List.of("git", "remote", "get-url", "origin"), workspace, SHORT_COMMAND, task, "检查远端").output().trim();
            if (!normalizedUrl(origin).equals(normalizedUrl(repository.url()))) {
                throw new IllegalStateException("工作目录的 origin 与配置不一致：" + workspace);
            }
            String status = required(List.of("git", "status", "--porcelain"), workspace, SHORT_COMMAND, task, "准备状态").output();
            if (!status.isBlank()) throw new IllegalStateException("工作目录存在未提交修改，请先处理：" + workspace);
            required(List.of("git", "fetch", "origin"), workspace, NETWORK_COMMAND, task, "拉取仓库");
        } else {
            required(List.of("git", "clone", "--branch", task.baseBranch(), repository.url(), workspace.toString()),
                    workspace.getParent(), NETWORK_COMMAND, task, "克隆仓库");
        }
        required(List.of("git", "checkout", task.baseBranch()), workspace, SHORT_COMMAND, task, "检出基础分支");
        required(List.of("git", "pull", "--ff-only", "origin", task.baseBranch()), workspace, NETWORK_COMMAND, task, "更新基础分支");
    }

    private TestEvidence baseline(AutoUtTask task, AutoUtRepositoryDefinition repository, Path workspace) {
        run(repository.testCommand(), workspace, TEST_COMMAND, task, "基线测试");
        return readSurefire(workspace);
    }

    private void repair(AutoUtTask task, Path workspace) {
        int attempt = task.attempts();
        TestEvidence evidence = readSurefire(workspace);
        Path prompt = writePrompt(task, evidence, attempt);
        AutoUtCommandResult pi = run(
                List.of(settings.piCommand(), "-p", "--mode", "json", "--no-context-files", "--session-id",
                        "auto-ut-" + task.id(), "@" + prompt, "执行修复并在完成后简要说明修改。"),
                workspace, Duration.ofSeconds(settings.piTimeoutSeconds()), task, "第" + attempt + "轮-Pi"
        );
        if (!pi.succeeded()) {
            retry(task, "第 " + attempt + " 轮 Pi 执行失败。");
            return;
        }
        GuardResult guard = inspectChanges(task, workspace, "第" + attempt + "轮");
        if (!guard.accepted()) {
            required(List.of("git", "stash", "push", "--include-untracked", "-m",
                    "auto-ut拒绝-" + task.id() + "-第" + attempt + "轮"), workspace, SHORT_COMMAND, task, "隔离违规修改");
            retry(task, "修改门禁未通过：" + String.join("；", guard.violations()));
            return;
        }
        task.record("修改门禁通过：" + guard.changedFiles().size() + " 个测试文件");
        task.waitFor(AutoUtStage.VERIFY, "第 " + attempt + " 轮修复完成，等待完整验证。", 60);
    }

    private void verify(AutoUtTask task, AutoUtRepositoryDefinition repository, Path workspace) {
        int attempt = task.attempts();
        AutoUtCommandResult verification = run(repository.verificationCommand(), workspace, TEST_COMMAND, task,
                "第" + attempt + "轮-完整验证");
        TestEvidence evidence = readSurefire(workspace);
        Coverage coverage = verification.succeeded()
                ? readCoverage(workspace.resolve(repository.coverageReport())) : new Coverage(0, 0);
        task.record("完整验证：共 " + evidence.tests() + "，失败 " + evidence.failedCount() + "，跳过 "
                + evidence.skipped() + "，行覆盖率 " + percentage(coverage.line()) + "，分支覆盖率 "
                + percentage(coverage.branch()));
        if (verification.succeeded() && evidence.failedCount() == 0 && evidence.skipped() == 0
                && coverage.line() >= task.lineGoal() && coverage.branch() >= task.branchGoal()) {
            task.waitFor(AutoUtStage.PUBLISH, "完整 UT 与覆盖率验证通过。", 85);
        } else {
            retry(task, verificationMessage(verification, evidence, coverage, task));
        }
    }

    private void retry(AutoUtTask task, String message) {
        if (task.attempts() >= settings.maxAttempts()) {
            task.changeStatus(AutoUtTaskStatus.RETRY_PENDING, message + " 已达到最大修复轮次。");
        } else {
            task.waitFor(AutoUtStage.REPAIR, message + " 等待下一轮修复。", 60);
        }
    }

    private void checkoutRepairBranch(AutoUtTask task, Path workspace) {
        AutoUtCommandResult local = run(List.of("git", "show-ref", "--verify", "--quiet", "refs/heads/" + task.repairBranch()),
                workspace, SHORT_COMMAND, task, "查询本地修复分支");
        if (local.succeeded()) {
            required(List.of("git", "checkout", task.repairBranch()), workspace, SHORT_COMMAND, task, "复用本地修复分支");
            return;
        }
        AutoUtCommandResult remote = run(List.of("git", "ls-remote", "--exit-code", "--heads", "origin", task.repairBranch()),
                workspace, SHORT_COMMAND, task, "查询远端修复分支");
        if (remote.succeeded()) {
            required(List.of("git", "checkout", "-B", task.repairBranch(), "origin/" + task.repairBranch()),
                    workspace, SHORT_COMMAND, task, "复用远端修复分支");
        } else {
            required(List.of("git", "checkout", "-b", task.repairBranch()), workspace, SHORT_COMMAND, task, "创建修复分支");
        }
    }

    private Path writePrompt(AutoUtTask task, TestEvidence evidence, int attempt) {
        try {
            Path directory = settings.logDirectory().resolve(task.id());
            Files.createDirectories(directory);
            Path prompt = directory.resolve("第" + attempt + "轮提示词.md");
            Files.writeString(prompt, String.join(System.lineSeparator(),
                    "你正在修复 Java 项目的单元测试。",
                    "只能修改或新增 src/test 目录中的文件，禁止修改生产代码、构建文件和门禁配置。",
                    "禁止删除测试、禁用测试、弱化或移除有效断言。请定位失败原因并修正测试。",
                    "报告中的失败用例数：" + task.reportedFailedTests(),
                    "行覆盖率目标：" + task.lineGoal(),
                    "分支覆盖率目标：" + task.branchGoal(),
                    "基线失败证据：",
                    evidence.details().isBlank() ? "未提取到详细失败堆栈，请读取 Surefire 报告。" : evidence.details()),
                    StandardCharsets.UTF_8);
            return prompt.toAbsolutePath();
        } catch (Exception exception) {
            throw new IllegalStateException("无法生成 Pi 提示词", exception);
        }
    }

    private GuardResult inspectChanges(AutoUtTask task, Path workspace, String prefix) {
        String status = required(List.of("git", "-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all"),
                workspace, SHORT_COMMAND, task, prefix + "-修改状态").output();
        List<String> changed = new ArrayList<>();
        List<String> violations = new ArrayList<>();
        for (String line : status.lines().toList()) {
            if (line.length() < 4) continue;
            String path = line.substring(3).replace('\\', '/');
            if (path.contains(" -> ")) path = path.substring(path.indexOf(" -> ") + 4);
            changed.add(path);
            if (!(path.startsWith("src/test/") || path.contains("/src/test/"))) violations.add("越界修改：" + path);
            if (line.substring(0, 2).trim().equals("D")) violations.add("禁止删除测试文件：" + path);
        }
        if (changed.isEmpty()) violations.add("Pi 未产生任何文件修改。");
        for (String relative : changed) {
            Path file = workspace.resolve(relative).normalize();
            if (!file.startsWith(workspace) || !Files.isRegularFile(file)) continue;
            try {
                String text = Files.readString(file, StandardCharsets.UTF_8);
                AutoUtCommandResult original = run(List.of("git", "show", "HEAD:" + relative), workspace, SHORT_COMMAND, task, prefix + "-原始测试-" + relative.hashCode());
                String added = original.succeeded()
                        ? required(List.of("git", "diff", "--unified=0", "--", relative), workspace, SHORT_COMMAND, task, prefix + "-测试差异-" + relative.hashCode()).output().lines()
                                .filter(line -> line.startsWith("+") && !line.startsWith("+++"))
                                .map(line -> line.substring(1)).reduce("", (left, right) -> left + "\n" + right)
                        : text;
                for (String marker : settings.forbiddenMarkers()) {
                    if (added.contains(marker)) violations.add("新增禁止标记 " + marker + "：" + relative);
                }
                if (TRIVIAL_ASSERTION.matcher(added).find()) violations.add("新增恒真断言：" + relative);
                if (original.succeeded()) {
                    if (count(text, "@Test") < count(original.output(), "@Test")) violations.add("测试方法数量减少：" + relative);
                    if (ASSERTION.matcher(text).results().count() < ASSERTION.matcher(original.output()).results().count()) {
                        violations.add("断言数量减少：" + relative);
                    }
                }
            } catch (Exception exception) {
                throw new IllegalStateException("无法检查测试修改：" + relative, exception);
            }
        }
        return new GuardResult(violations.isEmpty(), List.copyOf(changed), List.copyOf(violations));
    }

    private void publish(AutoUtTask task, AutoUtRepositoryDefinition repository, Path workspace) {
        GuardResult finalGuard = inspectChanges(task, workspace, "发布前");
        if (!finalGuard.accepted()) throw new IllegalStateException("发布前修改保护未通过：" + String.join("；", finalGuard.violations()));
        List<String> add = new ArrayList<>(List.of("git", "add", "--"));
        add.addAll(finalGuard.changedFiles());
        required(add, workspace, SHORT_COMMAND, task, "暂存修改");
        required(List.of("git", "commit", "-m", "[" + task.ticket() + "] 修复 " + task.repository() + " 单元测试"),
                workspace, SHORT_COMMAND, task, "提交修改");
        required(List.of("git", "push", "-u", "origin", task.repairBranch()), workspace, NETWORK_COMMAND, task, "推送修复分支");
        String url = required(List.of(settings.ghCommand(), "pr", "list", "--head", task.repairBranch(), "--base",
                task.baseBranch(), "--state", "open", "--json", "url", "--jq", ".[0].url"), workspace, SHORT_COMMAND, task, "查询PullRequest").output().trim();
        if (url.isBlank() && settings.createPullRequest()) {
            url = required(List.of(settings.ghCommand(), "pr", "create", "--head", task.repairBranch(), "--base", task.baseBranch(),
                    "--title", "[" + task.ticket() + "] 修复 " + task.repository() + " 单元测试",
                    "--body", "自动修复 " + task.reportedFailedTests() + " 个失败单元测试。\n\n完整 UT 与覆盖率验证已通过。"),
                    workspace, SHORT_COMMAND, task, "创建PullRequest").output().trim();
        }
        if (url.isBlank()) throw new IllegalStateException("未创建 Pull Request，且未找到对应的未关闭 Pull Request。");
        task.resolve(url.lines().reduce((first, second) -> second).orElse(url));
    }

    private TestEvidence readSurefire(Path workspace) {
        try (Stream<Path> paths = Files.walk(workspace)) {
            List<Path> reports = paths.filter(path -> path.getFileName().toString().startsWith("TEST-")
                    && path.getFileName().toString().endsWith(".xml")
                    && path.toString().replace('\\', '/').contains("/target/surefire-reports/")) .toList();
            if (reports.isEmpty()) throw new IllegalStateException("未找到 Maven Surefire XML 测试报告。");
            int tests = 0;
            int failures = 0;
            int errors = 0;
            int skipped = 0;
            List<String> details = new ArrayList<>();
            for (Path report : reports) {
                Element root = xml(report);
                tests += integer(root, "tests");
                failures += integer(root, "failures");
                errors += integer(root, "errors");
                skipped += integer(root, "skipped");
                var cases = root.getElementsByTagName("testcase");
                for (int index = 0; index < cases.getLength(); index++) {
                    Element testCase = (Element) cases.item(index);
                    Element problem = first(testCase, "failure", "error");
                    if (problem != null) details.add(testCase.getAttribute("classname") + "#" + testCase.getAttribute("name")
                            + "\n" + problem.getAttribute("message") + "\n" + limit(problem.getTextContent(), 4000));
                }
            }
            return new TestEvidence(tests, failures, errors, skipped, String.join("\n\n", details));
        } catch (IllegalStateException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalStateException("无法读取 Surefire 测试报告", exception);
        }
    }

    private Coverage readCoverage(Path report) {
        if (!Files.isRegularFile(report)) throw new IllegalStateException("未找到 JaCoCo 报告：" + report);
        Element root = xml(report);
        double line = 0;
        double branch = 1;
        var counters = root.getElementsByTagName("counter");
        for (int index = 0; index < counters.getLength(); index++) {
            Element counter = (Element) counters.item(index);
            double covered = Double.parseDouble(counter.getAttribute("covered"));
            double missed = Double.parseDouble(counter.getAttribute("missed"));
            double ratio = covered + missed == 0 ? 1 : covered / (covered + missed);
            if (counter.getAttribute("type").equals("LINE")) line = ratio;
            if (counter.getAttribute("type").equals("BRANCH")) branch = ratio;
        }
        return new Coverage(line, branch);
    }

    private Element xml(Path path) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setExpandEntityReferences(false);
            return factory.newDocumentBuilder().parse(path.toFile()).getDocumentElement();
        } catch (Exception exception) {
            throw new IllegalStateException("XML 报告格式无效：" + path, exception);
        }
    }

    private Element first(Element parent, String... names) {
        for (String name : names) {
            var nodes = parent.getElementsByTagName(name);
            if (nodes.getLength() > 0) return (Element) nodes.item(0);
        }
        return null;
    }

    private int integer(Element element, String name) {
        String value = element.getAttribute(name);
        return value.isBlank() ? 0 : Integer.parseInt(value);
    }

    private String verificationMessage(AutoUtCommandResult result, TestEvidence evidence, Coverage coverage, AutoUtTask task) {
        if (!result.succeeded()) return "完整验证命令执行失败。";
        if (evidence.failedCount() > 0 || evidence.skipped() > 0) {
            return "验证未通过：失败 " + evidence.failedCount() + "，跳过 " + evidence.skipped() + "。";
        }
        return "覆盖率未达标：行 " + percentage(coverage.line()) + "/" + percentage(task.lineGoal())
                + "，分支 " + percentage(coverage.branch()) + "/" + percentage(task.branchGoal()) + "。";
    }

    private String percentage(double value) {
        return String.format(Locale.ROOT, "%.2f%%", value * 100);
    }

    private int count(String text, String value) {
        return text.split(Pattern.quote(value), -1).length - 1;
    }

    private String limit(String value, int maximum) {
        return value.length() <= maximum ? value : value.substring(0, maximum);
    }

    private String normalizedUrl(String value) {
        return value.trim().replaceAll("/+$", "").toLowerCase(Locale.ROOT);
    }

    private AutoUtCommandResult required(List<String> command, Path directory, Duration timeout, AutoUtTask task, String label) {
        AutoUtCommandResult result = run(command, directory, timeout, task, label);
        if (!result.succeeded()) throw new IllegalStateException(label + "失败，退出码 " + result.exitCode() + "：" + limit(result.output(), 2000));
        return result;
    }

    private AutoUtCommandResult run(List<String> command, Path directory, Duration timeout, AutoUtTask task, String label) {
        return commands.run(command, directory, timeout, task.id(), label);
    }

    private record TestEvidence(int tests, int failures, int errors, int skipped, String details) {
        int failedCount() { return failures + errors; }
    }

    private record Coverage(double line, double branch) {
    }

    private record GuardResult(boolean accepted, List<String> changedFiles, List<String> violations) {
    }
}
