package com.jokter.containerops.deployment.infrastructure.ssh;

import com.jokter.containerops.deployment.application.DeploymentRemotePort;
import com.jokter.containerops.deployment.application.RemoteEndpoint;
import com.jokter.containerops.deployment.application.RemoteOperationResult;
import com.jokter.containerops.shared.infrastructure.ssh.SshEndpoint;
import com.jokter.containerops.shared.infrastructure.ssh.SshExecution;
import com.jokter.containerops.shared.infrastructure.ssh.SshRemoteOperations;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

@Component
class ApacheMinaDeploymentRemoteAdapter implements DeploymentRemotePort {
    private final SshRemoteOperations operations;

    ApacheMinaDeploymentRemoteAdapter(SshRemoteOperations operations) {
        this.operations = operations;
    }

    @Override
    public RemoteOperationResult execute(RemoteEndpoint endpoint, String command, long timeout, Consumer<String> output) {
        StringBuilder captured = new StringBuilder();
        SshExecution result = operations.execute(map(endpoint), command, timeout, line -> {
            captured.append(line).append('\n');
            output.accept(line);
        });
        return new RemoteOperationResult(result.exitCode(), captured.toString());
    }

    @Override
    public String readText(RemoteEndpoint endpoint, String path) {
        return operations.readText(map(endpoint), path, 120000);
    }

    @Override
    public List<String> listDirectories(RemoteEndpoint endpoint, String path) {
        return list(endpoint, path, "d");
    }

    @Override
    public List<String> listFiles(RemoteEndpoint endpoint, String path) {
        return list(endpoint, path, "f");
    }

    @Override
    public void upload(RemoteEndpoint endpoint, String directory, Map<String, byte[]> files) {
        operations.uploadFiles(map(endpoint), directory, files, 120000);
    }

    private List<String> list(RemoteEndpoint endpoint, String path, String type) {
        List<String> values = new ArrayList<>();
        String command = "find " + SshRemoteOperations.quote(path) + " -mindepth 1 -maxdepth 1 -type " + type + " -printf '%f\\n' | sort";
        RemoteOperationResult result = execute(endpoint, command, 120000, values::add);
        if (!result.succeeded()) {
            throw new IllegalStateException("远程目录读取失败：" + path);
        }
        return values.stream().filter(value -> !value.isBlank()).toList();
    }

    private SshEndpoint map(RemoteEndpoint endpoint) {
        return new SshEndpoint(endpoint.host(), endpoint.port(), endpoint.username(), endpoint.password());
    }
}
