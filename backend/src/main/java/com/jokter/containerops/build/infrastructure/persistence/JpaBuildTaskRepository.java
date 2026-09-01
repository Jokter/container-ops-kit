package com.jokter.containerops.build.infrastructure.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.build.application.BuildEventStream;
import com.jokter.containerops.build.application.BuildTaskNotFoundException;
import com.jokter.containerops.build.domain.model.BuildBranches;
import com.jokter.containerops.build.domain.model.BuildEvent;
import com.jokter.containerops.build.domain.model.BuildMode;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildStep;
import com.jokter.containerops.build.domain.model.BuildTask;
import com.jokter.containerops.build.domain.model.BuildTaskRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

@Repository
class JpaBuildTaskRepository implements BuildTaskRepository, BuildEventStream {
    private final SpringDataBuildTaskRepository data;
    private final ObjectMapper json;
    private final Map<String, BuildTask> liveTasks = new HashMap<>();
    private final Map<String, Long> publishedSequences = new HashMap<>();
    private final Map<String, CopyOnWriteArrayList<Consumer<BuildEvent>>> listeners = new HashMap<>();

    JpaBuildTaskRepository(SpringDataBuildTaskRepository data, ObjectMapper json) {
        this.data = data;
        this.json = json;
    }

    @PostConstruct
    void failInterruptedTasks() {
        findAll().stream().filter(task -> !task.status().terminal()).forEach(task -> {
            task.fail("服务重启，原构建进程状态已丢失，任务按整体失败处理");
            save(task);
        });
    }

    @Override
    public synchronized void save(BuildTask task) {
        data.save(toEntity(task));
        liveTasks.put(task.id(), task);
        long lastPublished = publishedSequences.getOrDefault(task.id(), 0L);
        task.events().stream().filter(event -> event.sequence() > lastPublished).forEach(event -> {
            listeners.getOrDefault(task.id(), new CopyOnWriteArrayList<>()).forEach(listener -> listener.accept(event));
            publishedSequences.put(task.id(), event.sequence());
        });
    }

    @Override
    public synchronized Optional<BuildTask> findById(String id) {
        BuildTask live = liveTasks.get(id);
        if (live != null) return Optional.of(live);
        return data.findById(id).map(this::toDomain);
    }

    @Override
    public synchronized List<BuildTask> findAll() {
        return data.findAllByOrderByCreatedAtDesc().stream()
                .map(entity -> liveTasks.getOrDefault(entity.id, toDomain(entity)))
                .toList();
    }

    @Override
    public synchronized void deleteById(String id) {
        data.deleteById(id);
        liveTasks.remove(id);
        listeners.remove(id);
        publishedSequences.remove(id);
    }

    @Override
    public synchronized Runnable subscribe(String taskId, long afterSequence, Consumer<BuildEvent> listener) {
        BuildTask task = findById(taskId).orElseThrow(BuildTaskNotFoundException::new);
        task.events().stream().filter(event -> event.sequence() > afterSequence).forEach(listener);
        listeners.computeIfAbsent(taskId, ignored -> new CopyOnWriteArrayList<>()).add(listener);
        return () -> listeners.getOrDefault(taskId, new CopyOnWriteArrayList<>()).remove(listener);
    }

    private BuildTaskJpaEntity toEntity(BuildTask task) {
        BuildTaskJpaEntity entity = data.findById(task.id()).orElseGet(BuildTaskJpaEntity::new);
        entity.id = task.id();
        entity.mode = task.mode().name();
        entity.environmentId = task.environmentId();
        entity.environmentName = task.environmentName();
        entity.module = task.module();
        entity.baselineCbbBranch = task.baseline().cbbWebDev().value();
        entity.baselineArchBranch = task.baseline().archDesign().value();
        entity.candidateCbbBranch = task.candidate() == null ? null : task.candidate().cbbWebDev().value();
        entity.candidateArchBranch = task.candidate() == null ? null : task.candidate().archDesign().value();
        entity.workspaceRoot = task.workspaceRoot();
        entity.status = task.status().name();
        entity.error = task.error();
        entity.createdAt = task.createdAt();
        entity.startedAt = task.startedAt();
        entity.finishedAt = task.finishedAt();
        entity.completedSteps = task.completedSteps();
        entity.eventSequence = task.sequence();
        entity.stepsJson = write(task.steps());
        // 实时日志只通过 SSE 和当前进程内的聚合传递，避免每一行 Maven 输出都重写大块 CLOB。
        entity.eventsJson = "[]";
        return entity;
    }

    private BuildTask toDomain(BuildTaskJpaEntity entity) {
        BuildBranches baseline = new BuildBranches(entity.baselineCbbBranch, entity.baselineArchBranch);
        BuildBranches candidate = entity.candidateCbbBranch == null ? null : new BuildBranches(entity.candidateCbbBranch, entity.candidateArchBranch);
        return BuildTask.restore(entity.id, BuildMode.valueOf(entity.mode), entity.environmentId, entity.environmentName,
                entity.module, baseline, candidate, entity.workspaceRoot, entity.createdAt,
                read(entity.stepsJson, new TypeReference<List<BuildStep>>() { }),
                read(entity.eventsJson, new TypeReference<List<BuildEvent>>() { }),
                BuildStatus.valueOf(entity.status), entity.startedAt, entity.finishedAt, entity.error,
                entity.completedSteps, entity.eventSequence);
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("构建任务序列化失败", exception);
        }
    }

    private <T> T read(String value, TypeReference<T> type) {
        try {
            return json.readValue(value, type);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("构建任务反序列化失败", exception);
        }
    }
}
