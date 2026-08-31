package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.domain.model.*;
import java.time.Instant;

public record EnvironmentResponse(Long id,ReleaseVersion releaseVersion,EnvironmentType type,String name,String host,Integer sshPort,String password,String rootPassword,String workDirectory,String architecture,String businessPlaneUrl,String businessPlaneUser,String businessPlanePassword,String managementPlaneUrl,String managementPlaneUser,String managementPlanePassword,ConnectionStatus connectionStatus,Instant lastTestedAt,Long lastTestLatencyMs,String lastTestError,Long version){
 static EnvironmentResponse from(Environment e){return new EnvironmentResponse(e.getId(),e.getReleaseVersion(),e.getType(),e.getName(),e.getHost(),e.getSshPort(),e.getPassword(),e.getRootPassword(),e.getWorkDirectory(),e.getArchitecture(),e.getBusinessPlaneUrl(),e.getBusinessPlaneUser(),e.getBusinessPlanePassword(),e.getManagementPlaneUrl(),e.getManagementPlaneUser(),e.getManagementPlanePassword(),e.getConnectionStatus(),e.getLastTestedAt(),e.getLastTestLatencyMs(),e.getLastTestError(),e.getVersion());}
}
