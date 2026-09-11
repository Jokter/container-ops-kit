package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtLiveEvent;

import java.util.function.Consumer;

public interface AutoUtLiveEventStream {
    AutoUtLiveEvent publish(
            String taskId, String type, String content, String toolCallId,
            String toolName, boolean error, boolean replace
    );

    Runnable subscribe(String taskId, long afterSequence, Consumer<AutoUtLiveEvent> listener);
}
