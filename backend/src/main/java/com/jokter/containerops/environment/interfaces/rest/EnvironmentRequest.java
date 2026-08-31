package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.EnvironmentCommand;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import jakarta.validation.constraints.*;

public record EnvironmentRequest(@NotNull Long releaseVersionId,@NotNull EnvironmentType type,@NotBlank String name,@NotBlank String host,@NotNull @Min(1) @Max(65535) Integer sshPort,@NotBlank String password,String workDirectory,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword,Long version){
 EnvironmentCommand toCommand(){return new EnvironmentCommand(releaseVersionId,type,name,host,sshPort,password,workDirectory,architecture,mae,maeUser,maePassword,osmu,osmuUser,osmuPassword,version);}
}