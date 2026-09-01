package com.jokter.containerops.build.application;

import com.jokter.containerops.build.domain.model.BuildModule;

import java.util.List;

public interface BuildModuleCatalog {
    List<BuildModule> findAll();

    BuildModule get(String name);
}
