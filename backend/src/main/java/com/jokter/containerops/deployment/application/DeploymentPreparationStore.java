package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;

import java.util.List;
import java.util.function.Consumer;

public interface DeploymentPreparationStore {
    void create(DeploymentPreparation preparation);

    DeploymentPreparation get(String id);

    void emit(String id, String stage, String service, String message);

    List<DeploymentEvent> events(String id);

    Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener);
}
