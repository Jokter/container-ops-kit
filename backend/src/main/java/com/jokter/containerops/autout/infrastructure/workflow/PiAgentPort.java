package com.jokter.containerops.autout.infrastructure.workflow;

import java.nio.file.Path;
import java.time.Duration;

public interface PiAgentPort {
    AutoUtCommandResult repair(String taskId, Path workspace, Path prompt, Duration timeout, String label);
}
