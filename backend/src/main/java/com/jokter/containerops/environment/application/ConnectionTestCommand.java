package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.EnvironmentType;

public record ConnectionTestCommand(EnvironmentType type,String host,Integer sshPort,String password) {}