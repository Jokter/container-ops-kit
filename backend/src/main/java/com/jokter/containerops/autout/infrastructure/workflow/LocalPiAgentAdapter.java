package com.jokter.containerops.autout.infrastructure.workflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.autout.application.AutoUtLiveEventStream;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class LocalPiAgentAdapter implements PiAgentPort {
    private static final int MAX_CAPTURED_CHARACTERS = 120_000;
    private final AutoUtSettings settings;
    private final ObjectMapper json;
    private final PiRpcEventMapper eventMapper;

    public LocalPiAgentAdapter(AutoUtSettings settings, ObjectMapper json, AutoUtLiveEventStream events) {
        this.settings = settings;
        this.json = json;
        this.eventMapper = new PiRpcEventMapper(events);
    }

    @Override
    public AutoUtCommandResult repair(String taskId, Path workspace, Path prompt, Duration timeout, String label) {
        if (!Files.isDirectory(workspace)) throw new IllegalStateException("Pi 工作目录不存在：" + workspace);
        try {
            ProcessBuilder builder = new ProcessBuilder(resolveWindowsScript(List.of(
                    settings.piCommand(), "--mode", "rpc", "--no-session", "--no-context-files", "--approve",
                    "--thinking", settings.piThinkingLevel()
            ))).directory(workspace.toFile()).redirectErrorStream(false);
            builder.environment().put("GIT_TERMINAL_PROMPT", "0");
            Process process = builder.start();
            AtomicBoolean settled = new AtomicBoolean();
            AtomicBoolean failed = new AtomicBoolean();
            StringBuilder output = new StringBuilder();
            Thread reader = Thread.ofVirtual().start(() -> readEvents(process, taskId, label, output, settled, failed));
            Thread errorReader = Thread.ofVirtual().start(() -> readErrors(process, taskId, label, output));

            Map<String, Object> request = new LinkedHashMap<>();
            request.put("id", "auto-ut-" + taskId);
            request.put("type", "prompt");
            request.put("message", Files.readString(prompt, StandardCharsets.UTF_8)
                    + System.lineSeparator() + "执行修复并在完成后简要说明修改。");
            process.getOutputStream().write((json.writeValueAsString(request) + "\n").getBytes(StandardCharsets.UTF_8));
            process.getOutputStream().flush();

            boolean completed = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!completed) {
                failed.set(true);
                eventMapper.publish(taskId, json.readTree("{\"type\":\"extension_error\",\"error\":\"Pi 执行超时\"}"));
                process.destroyForcibly();
            }
            reader.join();
            errorReader.join();
            if (!completed) return new AutoUtCommandResult(124, output + System.lineSeparator() + "Pi 执行超时");
            int exitCode = settled.get() && !failed.get() ? 0 : process.exitValue();
            if ((!settled.get() || failed.get()) && exitCode == 0) exitCode = 1;
            return new AutoUtCommandResult(exitCode, output.toString());
        } catch (IOException exception) {
            throw new IllegalStateException("无法执行 Pi：" + exception.getMessage(), exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Pi 执行被中断", exception);
        }
    }

    private void readErrors(Process process, String taskId, String label, StringBuilder output) {
        Path log = settings.logDirectory().resolve(taskId)
                .resolve(label.replaceAll("[^\\p{L}\\p{N}._-]", "_") + "-stderr.log");
        try {
            Files.createDirectories(log.getParent());
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8));
                 var writer = Files.newBufferedWriter(log, StandardCharsets.UTF_8,
                         StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    writer.write(line);
                    writer.newLine();
                    writer.flush();
                    synchronized (output) {
                        if (output.length() < MAX_CAPTURED_CHARACTERS) output.append(line).append(System.lineSeparator());
                    }
                    eventMapper.status(taskId, line);
                }
            }
        } catch (IOException ignored) {
        }
    }

    private void readEvents(
            Process process, String taskId, String label, StringBuilder output,
            AtomicBoolean settled, AtomicBoolean failed
    ) {
        Path log = settings.logDirectory().resolve(taskId)
                .resolve(label.replaceAll("[^\\p{L}\\p{N}._-]", "_") + ".log");
        try {
            Files.createDirectories(log.getParent());
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
                 var writer = Files.newBufferedWriter(log, StandardCharsets.UTF_8,
                         StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    writer.write(line);
                    writer.newLine();
                    writer.flush();
                    synchronized (output) {
                        if (output.length() < MAX_CAPTURED_CHARACTERS) output.append(line).append(System.lineSeparator());
                    }
                    try {
                        JsonNode event = json.readTree(line);
                        if (!eventMapper.publish(taskId, event)) failed.set(true);
                        String eventType = event.path("type").asText();
                        if (eventType.equals("agent_settled")
                                || (eventType.equals("agent_end") && !event.path("willRetry").asBoolean())
                                || (eventType.equals("response") && !event.path("success").asBoolean(true))) {
                            settled.set(true);
                            process.getOutputStream().close();
                            process.destroy();
                            break;
                        }
                    } catch (Exception malformed) {
                        eventMapper.publish(taskId, json.readTree("{\"type\":\"extension_error\",\"error\":\"无法解析 Pi RPC 事件\"}"));
                        failed.set(true);
                    }
                }
            }
        } catch (IOException exception) {
            failed.set(true);
            throw new IllegalStateException("无法读取 Pi RPC 输出", exception);
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
}
