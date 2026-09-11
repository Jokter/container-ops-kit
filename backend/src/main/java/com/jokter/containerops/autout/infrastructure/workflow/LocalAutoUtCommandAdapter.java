package com.jokter.containerops.autout.infrastructure.workflow;

import com.jokter.containerops.autout.application.AutoUtSettings;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@Component
public class LocalAutoUtCommandAdapter implements AutoUtCommandPort {
    private static final int MAX_CAPTURED_CHARACTERS = 120_000;
    private final AutoUtSettings settings;

    public LocalAutoUtCommandAdapter(AutoUtSettings settings) {
        this.settings = settings;
    }

    @Override
    public AutoUtCommandResult run(List<String> command, Path directory, Duration timeout, String taskId, String label) {
        try {
            if (!Files.isDirectory(directory)) {
                throw new IllegalStateException("命令工作目录不存在：" + directory);
            }
            ProcessBuilder builder = new ProcessBuilder(resolveWindowsScript(command))
                    .directory(directory.toFile())
                    .redirectErrorStream(true);
            builder.environment().put("GIT_TERMINAL_PROMPT", "0");
            builder.environment().put("GH_PROMPT_DISABLED", "1");
            Process process = builder.start();
            process.getOutputStream().close();
            StringBuilder output = new StringBuilder();
            Thread reader = Thread.ofVirtual().start(() -> readOutput(process, output, taskId, label, directory));
            boolean completed = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                process.destroyForcibly();
                reader.join();
                return new AutoUtCommandResult(124, output + System.lineSeparator() + "命令执行超时");
            }
            reader.join();
            return new AutoUtCommandResult(process.exitValue(), output.toString());
        } catch (IOException exception) {
            throw new IllegalStateException("无法执行 " + command.getFirst() + "：" + exception.getMessage(), exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("命令执行被中断", exception);
        }
    }

    private List<String> resolveWindowsScript(List<String> command) {
        if (!System.getProperty("os.name").toLowerCase(Locale.ROOT).startsWith("windows")) return command;
        String executable = command.getFirst();
        String pathValue = System.getenv("PATH");
        if (pathValue == null || executable.contains(".") || executable.contains("/") || executable.contains("\\")) return command;
        for (String directory : pathValue.split(";")) {
            for (String extension : List.of(".cmd", ".bat")) {
                Path candidate = Path.of(directory.replace("\"", ""), executable + extension);
                if (Files.isRegularFile(candidate)) {
                    List<String> resolved = new ArrayList<>(command);
                    resolved.set(0, candidate.toString());
                    return resolved;
                }
            }
        }
        return command;
    }

    private void readOutput(Process process, StringBuilder output, String taskId, String label, Path directory) {
        Path log = settings.logDirectory().resolve(taskId)
                .resolve(label.replaceAll("[^\\p{L}\\p{N}._-]", "_") + ".log");
        try {
            Files.createDirectories(log.getParent());
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
                 var writer = Files.newBufferedWriter(log, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    writer.write(line);
                    writer.newLine();
                    if (output.length() < MAX_CAPTURED_CHARACTERS) output.append(line).append(System.lineSeparator());
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("无法记录 Auto-UT 命令输出", exception);
        }
    }
}
