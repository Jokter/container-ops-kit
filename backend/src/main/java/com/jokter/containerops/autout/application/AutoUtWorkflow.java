package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtTask;

import java.util.function.Consumer;

@FunctionalInterface
public interface AutoUtWorkflow {
    void execute(AutoUtTask task, AutoUtRepositoryDefinition repository, Consumer<AutoUtTask> checkpoint);
}
