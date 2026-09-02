package com.jokter.containerops.deployment.infrastructure.runtime;

import com.jokter.containerops.deployment.application.DeploymentEvent;
import com.jokter.containerops.deployment.application.DeploymentNotFoundException;
import com.jokter.containerops.deployment.application.DeploymentPreparationStore;
import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

@Repository
class InMemoryDeploymentPreparationStore implements DeploymentPreparationStore {
    private static final Logger LOGGER = LoggerFactory.getLogger(InMemoryDeploymentPreparationStore.class);
    private final Map<String, DeploymentPreparation> preparations = new LinkedHashMap<>();
    private final Map<String, List<DeploymentEvent>> events = new LinkedHashMap<>();
    private final Map<String, CopyOnWriteArrayList<Consumer<DeploymentEvent>>> listeners = new LinkedHashMap<>();

    @Override
    public synchronized void create(DeploymentPreparation preparation) {
        preparations.put(preparation.id(), preparation);
        events.put(preparation.id(), new ArrayList<>());
    }

    @Override
    public synchronized DeploymentPreparation get(String id) {
        DeploymentPreparation preparation = preparations.get(id);
        if (preparation == null) {
            throw new DeploymentNotFoundException("部署准备不存在或服务已重启");
        }
        return preparation;
    }

    @Override
    public synchronized void emit(String id, String stage, String service, String message) {
        List<DeploymentEvent> taskEvents = events.get(id);
        if (taskEvents == null) {
            throw new DeploymentNotFoundException("部署准备不存在或服务已重启");
        }
        DeploymentEvent event = new DeploymentEvent(taskEvents.size() + 1L, Instant.now(), stage, service, message);
        taskEvents.add(event);
        if (taskEvents.size() > 10000) {
            taskEvents.remove(0);
        }
        LOGGER.info("deploymentId={} stage={} service={} message={}", id, stage, service, message);
        listeners.getOrDefault(id, new CopyOnWriteArrayList<>()).forEach(listener -> listener.accept(event));
    }

    @Override
    public synchronized List<DeploymentEvent> events(String id) {
        get(id);
        return List.copyOf(events.get(id));
    }

    @Override
    public synchronized Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener) {
        get(id);
        events.get(id).stream().filter(event -> event.sequence() > afterSequence).forEach(listener);
        listeners.computeIfAbsent(id, ignored -> new CopyOnWriteArrayList<>()).add(listener);
        return () -> listeners.getOrDefault(id, new CopyOnWriteArrayList<>()).remove(listener);
    }
}
