package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class DeploymentApplicationServiceTest {
    @Test
    void filtersBuildServicesByWorkloadsInTheSelectedNamespace() {
        RemoteEndpoint endpoint = new RemoteEndpoint("host", 22, "root", "password");
        DeploymentArtifact artifact = new DeploymentArtifact(1L, "mae-access", "charts", endpoint, "/module", "/charts");
        DeploymentTarget target = new DeploymentTarget(2L, "environment", endpoint);
        List<String> commands = new ArrayList<>();
        DeploymentContextPort context = new DeploymentContextPort() {
            @Override
            public DeploymentArtifact artifact(Long artifactId) {
                return artifact;
            }

            @Override
            public DeploymentTarget target(Long environmentId) {
                return target;
            }
        };
        DeploymentRemotePort remote = new DeploymentRemotePort() {
            @Override
            public RemoteOperationResult execute(RemoteEndpoint ignored, String command, long timeout, Consumer<String> output) {
                commands.add(command);
                if (command.contains("get namespaces")) return new RemoteOperationResult(0, "mae\nother\n");
                if (command.contains("get pods -n 'mae'")) {
                    return new RemoteOperationResult(0, """
                            {"items":[{"metadata":{"name":"fmproductfrontendservice-a"},"status":{"phase":"Running","containerStatuses":[{"name":"fmproductfrontendservice","ready":true,"imageID":"sha256:fm"}]},"spec":{"containers":[{"name":"fmproductfrontendservice"}]}}]}
                            """);
                }
                return new RemoteOperationResult(1, "unexpected command");
            }

            @Override
            public String readText(RemoteEndpoint ignored, String path) {
                throw new UnsupportedOperationException();
            }

            @Override
            public List<String> listDirectories(RemoteEndpoint ignored, String path) {
                return List.of("fmproductfrontendservice", "accesscommonds");
            }

            @Override
            public List<String> listFiles(RemoteEndpoint ignored, String path) {
                throw new UnsupportedOperationException();
            }

            @Override
            public void upload(RemoteEndpoint ignored, String directory, Map<String, byte[]> files) {
                throw new UnsupportedOperationException();
            }
        };
        DeploymentRuntimeSettings runtime = new DeploymentRuntimeSettings() {
            @Override
            public String kubectlKubeconfig() {
                return "/custom/kubectl.conf";
            }

            @Override
            public String helmKubeconfig() {
                return "/custom/helm.conf";
            }

            @Override
            public String lockFile() {
                return "/version/lock.json";
            }

            @Override
            public String jarListFile() {
                return "/version/jarlist.json";
            }
        };
        DeploymentApplicationService service = new DeploymentApplicationService(
                context, remote, null, null, runtime, new ObjectMapper(), Runnable::run);

        DeploymentCandidates result = service.candidates(1L, 2L, "mae");

        assertThat(result.namespaces()).containsExactly("mae", "other");
        assertThat(result.services()).containsExactly("fmproductfrontendservice");
        assertThat(commands).allMatch(command -> command.startsWith("kubectl --kubeconfig='/custom/kubectl.conf'"));
    }
}
