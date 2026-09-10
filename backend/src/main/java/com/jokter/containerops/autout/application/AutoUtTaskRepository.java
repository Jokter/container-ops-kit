package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtTask;

import java.util.List;
import java.util.Optional;

public interface AutoUtTaskRepository {
    AutoUtTask save(AutoUtTask task);
    Optional<AutoUtTask> findById(String id);
    List<AutoUtTask> findAll();
}
