package com.jokter.containerops.containerresource.infrastructure.ssh;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.jokter.containerops.containerresource.application.ContainerResourceConflictException;
import com.jokter.containerops.containerresource.application.ContainerResourceTarget;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.shared.infrastructure.ssh.SshExecution;
import com.jokter.containerops.shared.infrastructure.ssh.SshRemoteOperations;
import org.junit.jupiter.api.Test;

import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SshKubectlContainerResourceAdapterTest {
    private final ContainerResourceTarget target = new ContainerResourceTarget(1L, "开发环境", "127.0.0.1", 22, "root", "password");
    private final ResourceCoordinates coordinates = new ResourceCoordinates("apps", "v1", "deployments", "mae", "demo-service");

    @Test
    void removesServerOwnedFieldsButKeepsResourceVersionWhenReading() {
        SshRemoteOperations operations = mock(SshRemoteOperations.class);
        when(operations.execute(any(), contains("kubectl get"), anyLong(), any())).thenAnswer(invocation -> {
            Consumer<String> output = invocation.getArgument(3);
            output.accept("[stderr] Warning: v1 Endpoints is deprecated");
            output.accept("{\"apiVersion\":\"apps/v1\",\"kind\":\"Deployment\",\"metadata\":{\"name\":\"demo-service\",\"namespace\":\"mae\",\"resourceVersion\":\"23\",\"uid\":\"uid\",\"managedFields\":[{}]},\"spec\":{\"replicas\":2},\"status\":{\"readyReplicas\":2}}");
            return new SshExecution(0);
        });
        SshKubectlContainerResourceAdapter adapter = adapter(operations);

        EditableResource resource = adapter.readResource(target, coordinates);

        assertEquals("23", resource.resourceVersion());
        assertFalse(resource.yaml().contains("managedFields"));
        assertFalse(resource.yaml().contains("uid:"));
        assertFalse(resource.yaml().contains("status:"));
    }

    @Test
    void rejectsUpdateWhenLiveResourceVersionChanged() {
        SshRemoteOperations operations = mock(SshRemoteOperations.class);
        when(operations.execute(any(), contains("kubectl get"), anyLong(), any())).thenAnswer(invocation -> {
            Consumer<String> output = invocation.getArgument(3);
            output.accept("{\"metadata\":{\"resourceVersion\":\"24\"}}");
            return new SshExecution(0);
        });
        SshKubectlContainerResourceAdapter adapter = adapter(operations);

        assertThrows(ContainerResourceConflictException.class, () -> adapter.applyUpdate(target, coordinates, "yaml", "23"));
    }

    private SshKubectlContainerResourceAdapter adapter(SshRemoteOperations operations) {
        return new SshKubectlContainerResourceAdapter(operations, new ObjectMapper(), new ObjectMapper(new YAMLFactory()));
    }
}
