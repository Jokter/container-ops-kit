package com.jokter.containerops.build.infrastructure.ssh;

import com.jokter.containerops.build.application.RemoteCommandPort;
import com.jokter.containerops.build.application.RemoteCommandResult;
import com.jokter.containerops.build.application.RemoteTarget;
import com.jokter.containerops.shared.infrastructure.ssh.SshEndpoint;
import com.jokter.containerops.shared.infrastructure.ssh.SshRemoteOperations;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.function.Consumer;

@Component
class ApacheMinaRemoteCommandAdapter implements RemoteCommandPort {
    private final SshRemoteOperations operations;
    private final long commandTimeout;

    ApacheMinaRemoteCommandAdapter(
            SshRemoteOperations operations,
            @Value("${build.ssh.command-timeout:1800000}") long commandTimeout
    ) {
        this.operations = operations;
        this.commandTimeout = commandTimeout;
    }

    @Override
    public RemoteCommandResult execute(RemoteTarget target, String command, Consumer<String> output) {
        SshEndpoint endpoint = new SshEndpoint(target.host(), target.port(), target.username(), target.password());
        return new RemoteCommandResult(operations.execute(endpoint, command, commandTimeout, output).exitCode());
    }
}
