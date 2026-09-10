package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtSchedule;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.time.ZonedDateTime;
import java.util.Optional;

@Service
public class AutoUtScheduleService {
    private final AutoUtScheduleRepository schedules;
    private final AutoUtApplicationService autoUt;
    private final Clock clock;

    public AutoUtScheduleService(AutoUtScheduleRepository schedules, AutoUtApplicationService autoUt, Clock clock) {
        this.schedules = schedules;
        this.autoUt = autoUt;
        this.clock = clock;
    }

    public AutoUtSchedule save(
            String reportFileName, byte[] report, String username, String ticket, String baseBranch,
            String workspaceRoot, String dailyTime
    ) {
        if (report == null || report.length == 0 || reportFileName == null || reportFileName.isBlank()) {
            throw new IllegalArgumentException("请选择 CSV");
        }
        String normalizedWorkspace = autoUt.validateExecution(username, ticket, baseBranch, workspaceRoot).toString();
        LocalTime time;
        try {
            time = LocalTime.parse(dailyTime);
        } catch (DateTimeParseException | NullPointerException exception) {
            throw new IllegalArgumentException("请选择有效的每日执行时间");
        }
        AutoUtSchedule schedule = new AutoUtSchedule(
                reportFileName, report, username, ticket, baseBranch, normalizedWorkspace, time);
        return schedules.save(schedule);
    }

    public Optional<AutoUtSchedule> get() {
        return schedules.find();
    }

    public void delete() {
        schedules.delete();
    }

    @Transactional
    public synchronized void triggerDue() {
        ZonedDateTime now = ZonedDateTime.now(clock);
        schedules.find().filter(schedule -> schedule.isDue(now)).ifPresent(schedule -> {
            autoUt.start(schedule.report(), schedule.username(), schedule.ticket(), schedule.baseBranch(),
                    schedule.workspaceRoot(), AutoUtExecutionMode.AUTOMATIC);
            schedule.markTriggered(now);
            schedules.save(schedule);
        });
    }
}
