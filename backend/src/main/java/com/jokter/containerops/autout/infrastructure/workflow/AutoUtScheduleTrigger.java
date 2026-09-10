package com.jokter.containerops.autout.infrastructure.workflow;

import com.jokter.containerops.autout.application.AutoUtScheduleService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class AutoUtScheduleTrigger {
    private final AutoUtScheduleService schedules;

    public AutoUtScheduleTrigger(AutoUtScheduleService schedules) {
        this.schedules = schedules;
    }

    @Scheduled(fixedDelay = 30000)
    public void trigger() {
        schedules.triggerDue();
    }
}
