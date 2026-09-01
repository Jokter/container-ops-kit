package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.domain.model.BuildEvent;
import com.jokter.containerops.build.domain.model.BuildEventType;
import com.jokter.containerops.build.domain.model.BuildStatus;

import java.time.Instant;

public record BuildEventResponse(
        long sequence,
        Instant occurredAt,
        BuildEventType type,
        String stepId,
        String message,
        int progress,
        BuildStatus taskStatus
) {
    static BuildEventResponse from(BuildEvent event) {
        return new BuildEventResponse(
                event.sequence(),
                event.occurredAt(),
                event.type(),
                event.stepId(),
                event.message(),
                event.progress(),
                event.taskStatus()
        );
    }
}
