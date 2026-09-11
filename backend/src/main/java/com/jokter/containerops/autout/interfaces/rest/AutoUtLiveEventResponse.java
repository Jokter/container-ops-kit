package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.domain.model.AutoUtLiveEvent;

import java.time.Instant;

public record AutoUtLiveEventResponse(
        long sequence,
        Instant time,
        String type,
        String content,
        String toolCallId,
        String toolName,
        boolean error,
        boolean replace
) {
    static AutoUtLiveEventResponse from(AutoUtLiveEvent event) {
        return new AutoUtLiveEventResponse(
                event.sequence(), event.time(), event.type(), event.content(), event.toolCallId(),
                event.toolName(), event.error(), event.replace()
        );
    }
}
