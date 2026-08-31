package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.SshUser;

public record ConnectionTestCommand(SshUser user, String host, Integer sshPort, String password) {
}
