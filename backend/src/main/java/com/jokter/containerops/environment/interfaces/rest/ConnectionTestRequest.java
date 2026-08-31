package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.ConnectionTestCommand;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import jakarta.validation.constraints.*;

public record ConnectionTestRequest(@NotNull EnvironmentType type,@NotBlank String host,@NotNull @Min(1) @Max(65535) Integer sshPort,@NotBlank String password){
 ConnectionTestCommand toCommand(){return new ConnectionTestCommand(type,host,sshPort,password);}
}