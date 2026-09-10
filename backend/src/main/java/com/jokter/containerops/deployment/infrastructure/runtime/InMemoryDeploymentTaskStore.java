package com.jokter.containerops.deployment.infrastructure.runtime;

import com.jokter.containerops.deployment.application.DeploymentEvent;
import com.jokter.containerops.deployment.application.DeploymentNotFoundException;
import com.jokter.containerops.deployment.application.DeploymentTaskStore;
import com.jokter.containerops.deployment.domain.model.DeploymentTask;
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
class InMemoryDeploymentTaskStore implements DeploymentTaskStore {
    private static final Logger LOGGER = LoggerFactory.getLogger(InMemoryDeploymentTaskStore.class);
    private final int eventRetentionLimit;
    private final Map<String, DeploymentTask> tasks = new LinkedHashMap<>();
    private final Map<String, List<DeploymentEvent>> events = new LinkedHashMap<>();
    private final Map<String, CopyOnWriteArrayList<Consumer<DeploymentEvent>>> listeners = new LinkedHashMap<>();

    InMemoryDeploymentTaskStore() {
        this(10000);
    }

    InMemoryDeploymentTaskStore(int eventRetentionLimit) {
        this.eventRetentionLimit = eventRetentionLimit;
    }

    @Override
    public synchronized void create(DeploymentTask task) {
        tasks.put(task.id(), task);
        events.put(task.id(), new ArrayList<>());
    }

    @Override
    public synchronized DeploymentTask get(String id) {
        DeploymentTask task = tasks.get(id);
        if (task == null) {
            throw new DeploymentNotFoundException("部署任务不存在或服务已重启");
        }
        return task;
    }

    @Override
    public synchronized void emit(String id, String stage, String service, String message) {
        List<DeploymentEvent> taskEvents = events.get(id);
        if (taskEvents == null) {
            throw new DeploymentNotFoundException("部署任务不存在或服务已重启");
        }
        long sequence = taskEvents.isEmpty() ? 1L : taskEvents.get(taskEvents.size() - 1).sequence() + 1L;
        DeploymentEvent event = new DeploymentEvent(sequence, Instant.now(), stage, service, message);
        taskEvents.add(event);
        if (taskEvents.size() > eventRetentionLimit) {
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
