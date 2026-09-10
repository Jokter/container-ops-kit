package com.jokter.containerops.autout.infrastructure.workflow;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

public interface AutoUtCommandPort {
    AutoUtCommandResult run(List<String> command, Path directory, Duration timeout, String taskId, String label);
}
