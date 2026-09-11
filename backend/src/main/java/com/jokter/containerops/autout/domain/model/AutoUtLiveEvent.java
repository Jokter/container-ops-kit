package com.jokter.containerops.autout.domain.model;

import java.time.Instant;

public record AutoUtLiveEvent(
        long sequence,
        Instant time,
        String type,
        String content,
        String toolCallId,
        String toolName,
        boolean error,
        boolean replace
) {
}
