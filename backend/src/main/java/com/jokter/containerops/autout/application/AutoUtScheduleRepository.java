package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtSchedule;

import java.util.Optional;

public interface AutoUtScheduleRepository {
    AutoUtSchedule save(AutoUtSchedule schedule);
    Optional<AutoUtSchedule> find();
    void delete();
}
