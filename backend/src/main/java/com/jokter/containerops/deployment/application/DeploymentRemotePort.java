package com.jokter.containerops.deployment.application;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public interface DeploymentRemotePort {
    RemoteOperationResult execute(RemoteEndpoint endpoint, String command, long timeout, Consumer<String> output);

    String readText(RemoteEndpoint endpoint, String path);

    List<String> listDirectories(RemoteEndpoint endpoint, String path);

    List<String> listFiles(RemoteEndpoint endpoint, String path);

    void upload(RemoteEndpoint endpoint, String directory, Map<String, byte[]> files);
}
