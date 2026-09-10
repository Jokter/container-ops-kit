package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.domain.model.AutoUtSchedule;

import java.time.Instant;
import java.time.LocalDate;

public record AutoUtScheduleResponse(
        String reportFileName,
        String username,
        String ticket,
        String baseBranch,
        String workspaceRoot,
        String dailyTime,
        LocalDate lastTriggeredOn,
        Instant updatedAt
) {
    static AutoUtScheduleResponse from(AutoUtSchedule schedule) {
        return new AutoUtScheduleResponse(
                schedule.reportFileName(), schedule.username(), schedule.ticket(), schedule.baseBranch(), schedule.workspaceRoot(),
                schedule.dailyTime().toString(), schedule.lastTriggeredOn(), schedule.updatedAt());
    }
}
