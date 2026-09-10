package com.jokter.containerops.autout.infrastructure.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.autout.application.AutoUtTaskRepository;
import com.jokter.containerops.autout.domain.model.AutoUtTask;
import com.jokter.containerops.autout.domain.model.AutoUtTaskEvent;
import com.jokter.containerops.autout.domain.model.AutoUtTaskStatus;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtStage;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Repository
public class JpaAutoUtTaskRepository implements AutoUtTaskRepository {
    private final SpringDataAutoUtTaskRepository repository;
    private final ObjectMapper objectMapper;

    public JpaAutoUtTaskRepository(SpringDataAutoUtTaskRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void markInterruptedTasks() {
        findAll().stream().filter(task -> task.status().inProgress()).forEach(task -> {
            task.changeStatus(AutoUtTaskStatus.WAITING_EXTERNAL, "服务重启，原 Auto-UT 进程状态已丢失，请检查工作目录后重新提交任务。");
            save(task);
        });
    }

    @Override
    @Transactional
    public AutoUtTask save(AutoUtTask task) {
        AutoUtTaskJpaEntity entity = new AutoUtTaskJpaEntity();
        entity.id = task.id();
        entity.repository = task.repository();
        entity.username = task.username();
        entity.ticket = task.ticket();
        entity.baseBranch = task.baseBranch();
        entity.repairBranch = task.repairBranch();
        entity.reportedFailedTests = task.reportedFailedTests();
        entity.lineGoal = task.lineGoal();
        entity.branchGoal = task.branchGoal();
        entity.workspaceRoot = task.workspaceRoot();
        entity.executionMode = task.executionMode().name();
        entity.status = task.status().name();
        entity.nextStage = task.nextStage().name();
        entity.progress = task.progress();
        entity.attempts = task.attempts();
        entity.message = task.message();
        entity.pullRequestUrl = task.pullRequestUrl();
        entity.createdAt = task.createdAt();
        entity.updatedAt = task.updatedAt();
        try {
            entity.historyJson = objectMapper.writeValueAsString(task.history());
        } catch (Exception exception) {
            throw new IllegalStateException("无法保存 Auto-UT 任务历史", exception);
        }
        repository.save(entity);
        return task;
    }

    @Override
    public Optional<AutoUtTask> findById(String id) {
        return repository.findById(id).map(this::domain);
    }

    @Override
    public List<AutoUtTask> findAll() {
        return repository.findAll().stream().map(this::domain).toList();
    }

    private AutoUtTask domain(AutoUtTaskJpaEntity entity) {
        try {
            List<AutoUtTaskEvent> history = objectMapper.readValue(entity.historyJson, new TypeReference<>() {});
            return AutoUtTask.restore(
                    entity.id, entity.repository, entity.username, entity.ticket, entity.baseBranch,
                    entity.repairBranch, entity.reportedFailedTests, entity.lineGoal, entity.branchGoal,
                    entity.workspaceRoot, AutoUtExecutionMode.valueOf(entity.executionMode),
                    AutoUtTaskStatus.valueOf(entity.status), AutoUtStage.valueOf(entity.nextStage),
                    entity.progress, entity.attempts, entity.message,
                    entity.pullRequestUrl, entity.createdAt, entity.updatedAt, history
            );
        } catch (Exception exception) {
            throw new IllegalStateException("无法读取 Auto-UT 任务历史", exception);
        }
    }
}
