package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildEvent;

import java.util.function.Consumer;

public interface BuildEventStream {
    Runnable subscribe(String taskId, long afterSequence, Consumer<BuildEvent> listener);
}
