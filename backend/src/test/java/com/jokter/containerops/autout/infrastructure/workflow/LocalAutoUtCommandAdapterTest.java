package com.jokter.containerops.autout.infrastructure.workflow;

import com.jokter.containerops.autout.application.AutoUtRepositoryDefinition;
import com.jokter.containerops.autout.application.AutoUtSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class LocalAutoUtCommandAdapterTest {
    @TempDir
    Path temporary;

    @Test
    void 可以执行Path中的跨平台命令入口() throws Exception {
        Files.createDirectories(temporary.resolve("workspace"));
        AutoUtCommandResult result = new LocalAutoUtCommandAdapter(new TestSettings(temporary))
                .run(List.of("mvn", "-v"), temporary.resolve("workspace"), Duration.ofSeconds(10), "task", "版本检查");

        assertThat(result.succeeded()).isTrue();
        assertThat(result.output()).contains("Apache Maven");
    }

    @Test
    void 不会为命令静默创建缺失的工作目录() {
        LocalAutoUtCommandAdapter adapter = new LocalAutoUtCommandAdapter(new TestSettings(temporary));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> adapter.run(
                        List.of("mvn", "-v"), temporary.resolve("missing"), Duration.ofSeconds(10), "task", "版本检查"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("命令工作目录不存在");
    }

    @Test
    void 非交互命令可以收到标准输入结束信号() throws Exception {
        Files.createDirectories(temporary.resolve("workspace"));

        AutoUtCommandResult result = new LocalAutoUtCommandAdapter(new TestSettings(temporary)).run(
                List.of("cmd.exe", "/d", "/c", "more > nul & echo stdin-closed"),
                temporary.resolve("workspace"), Duration.ofSeconds(1), "task", "输入结束检查");

        assertThat(result.succeeded()).isTrue();
        assertThat(result.output()).contains("stdin-closed");
    }

    private record TestSettings(Path root) implements AutoUtSettings {
        @Override public String language() { return "Java"; }
        @Override public String plGroup() { return "Access_智能监控组"; }
        @Override public Path logDirectory() { return root.resolve("logs"); }
        @Override public String piCommand() { return "pi"; }
        @Override public int piTimeoutSeconds() { return 1800; }
        @Override public int maxAttempts() { return 3; }
        @Override public List<String> forbiddenMarkers() { return List.of(); }
        @Override public String codeHubCommand() { return "codehub-cli"; }
        @Override public boolean createMergeRequest() { return true; }
        @Override public Optional<AutoUtRepositoryDefinition> repository(String name) { return Optional.empty(); }
    }
}
