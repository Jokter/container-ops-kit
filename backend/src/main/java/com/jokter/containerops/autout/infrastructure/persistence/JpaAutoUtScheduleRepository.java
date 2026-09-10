package com.jokter.containerops.autout.infrastructure.persistence;

import com.jokter.containerops.autout.application.AutoUtScheduleRepository;
import com.jokter.containerops.autout.domain.model.AutoUtSchedule;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class JpaAutoUtScheduleRepository implements AutoUtScheduleRepository {
    private final SpringDataAutoUtScheduleRepository repository;

    public JpaAutoUtScheduleRepository(SpringDataAutoUtScheduleRepository repository) {
        this.repository = repository;
    }

    @Override
    public AutoUtSchedule save(AutoUtSchedule schedule) {
        AutoUtScheduleJpaEntity entity = new AutoUtScheduleJpaEntity();
        entity.id = AutoUtSchedule.ID;
        entity.reportFileName = schedule.reportFileName();
        entity.reportContent = schedule.report();
        entity.username = schedule.username();
        entity.ticket = schedule.ticket();
        entity.baseBranch = schedule.baseBranch();
        entity.workspaceRoot = schedule.workspaceRoot();
        entity.dailyTime = schedule.dailyTime();
        entity.lastTriggeredOn = schedule.lastTriggeredOn();
        entity.updatedAt = schedule.updatedAt();
        repository.save(entity);
        return schedule;
    }

    @Override
    public Optional<AutoUtSchedule> find() {
        return repository.findById(AutoUtSchedule.ID).map(entity -> AutoUtSchedule.restore(
                entity.reportFileName, entity.reportContent, entity.username, entity.ticket, entity.baseBranch,
                entity.workspaceRoot, entity.dailyTime, entity.lastTriggeredOn, entity.updatedAt));
    }

    @Override
    public void delete() {
        repository.deleteById(AutoUtSchedule.ID);
    }
}
