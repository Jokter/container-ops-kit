package com.jokter.containerops.build.domain.model;

import java.time.Instant;

public record BuildEvent(
        long sequence,
        Instant occurredAt,
        BuildEventType type,
        String stepId,
        String message,
        int progress,
        BuildStatus taskStatus
) {
}
