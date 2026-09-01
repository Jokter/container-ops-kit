package com.jokter.containerops.build.infrastructure.runtime;

import com.jokter.containerops.build.application.BuildEventStream;
import com.jokter.containerops.build.application.BuildTaskNotFoundException;
import com.jokter.containerops.build.domain.model.BuildEvent;
import com.jokter.containerops.build.domain.model.BuildTask;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

@Repository
class InMemoryBuildTaskRepository implements BuildTaskRepository, BuildEventStream {
    private final Map<String, BuildTask> tasks = new LinkedHashMap<>();
    private final Map<String, Long> publishedSequences = new HashMap<>();
    private final Map<String, CopyOnWriteArrayList<Consumer<BuildEvent>>> listeners = new HashMap<>();

    @Override
    public synchronized void save(BuildTask task) {
        tasks.put(task.id(), task);
        long lastPublished = publishedSequences.getOrDefault(task.id(), 0L);
        List<BuildEvent> pending = task.events().stream().filter(event -> event.sequence() > lastPublished).toList();
        for (BuildEvent event : pending) {
            for (Consumer<BuildEvent> listener : listeners.getOrDefault(task.id(), new CopyOnWriteArrayList<>())) {
                listener.accept(event);
            }
            publishedSequences.put(task.id(), event.sequence());
        }
    }

    @Override
    public synchronized Optional<BuildTask> findById(String id) {
        return Optional.ofNullable(tasks.get(id));
    }

    @Override
    public synchronized Runnable subscribe(String taskId, long afterSequence, Consumer<BuildEvent> listener) {
        BuildTask task = Optional.ofNullable(tasks.get(taskId)).orElseThrow(BuildTaskNotFoundException::new);
        task.events().stream().filter(event -> event.sequence() > afterSequence).forEach(listener);
        listeners.computeIfAbsent(taskId, ignored -> new CopyOnWriteArrayList<>()).add(listener);
        return () -> listeners.getOrDefault(taskId, new CopyOnWriteArrayList<>()).remove(listener);
    }
}
