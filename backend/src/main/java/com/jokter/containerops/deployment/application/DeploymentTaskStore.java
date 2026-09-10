package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.DeploymentTask;

import java.util.List;
import java.util.function.Consumer;

public interface DeploymentTaskStore {
    void create(DeploymentTask task);

    DeploymentTask get(String id);

    void emit(String id, String stage, String service, String message);

    List<DeploymentEvent> events(String id);

    Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener);
}
