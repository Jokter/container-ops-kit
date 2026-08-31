package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.domain.model.*;
import java.time.Instant;

public record EnvironmentResponse(Long id,ReleaseVersion releaseVersion,EnvironmentType type,String name,String host,Integer sshPort,String password,String workDirectory,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword,ConnectionStatus connectionStatus,Instant lastTestedAt,Long lastTestLatencyMs,String lastTestError,Long version){
 static EnvironmentResponse from(Environment e){return new EnvironmentResponse(e.getId(),e.getReleaseVersion(),e.getType(),e.getName(),e.getHost(),e.getSshPort(),e.getPassword(),e.getWorkDirectory(),e.getArchitecture(),e.getMae(),e.getMaeUser(),e.getMaePassword(),e.getOsmu(),e.getOsmuUser(),e.getOsmuPassword(),e.getConnectionStatus(),e.getLastTestedAt(),e.getLastTestLatencyMs(),e.getLastTestError(),e.getVersion());}
}