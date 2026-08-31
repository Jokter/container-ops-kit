package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.EnvironmentType;

public record EnvironmentCommand(Long releaseVersionId,EnvironmentType type,String name,String host,Integer sshPort,String password,String workDirectory,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword,Long version){}