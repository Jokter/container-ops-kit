package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.ConnectionTestCommand;
import com.jokter.containerops.environment.domain.model.SshUser;
import jakarta.validation.constraints.*;

public record ConnectionTestRequest(@NotNull SshUser user,@NotBlank String host,@NotNull @Min(1) @Max(65535) Integer sshPort,@NotBlank String password){
 ConnectionTestCommand toCommand(){return new ConnectionTestCommand(user,host,sshPort,password);}
}
