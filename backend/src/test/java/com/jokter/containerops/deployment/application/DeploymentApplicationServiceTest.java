package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;
import com.jokter.containerops.deployment.domain.model.DeploymentStage;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
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
                    return new RemoteOperationResult(0,
                            "fmproductfrontendservice-a\tfmproductfrontendservice\tRunning\ttrue\tsha256:fm\n");
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
        assertThat(commands).noneMatch(command -> command.contains("-o json"));
        assertThat(commands).anyMatch(command -> command.contains("-o go-template="));
    }

    @Test
    void skipsOmCollectionWhenSourceFilesContainNoDynamicValues() {
        RemoteEndpoint endpoint = new RemoteEndpoint("host", 22, "root", "password");
        DeploymentArtifact artifact = new DeploymentArtifact(1L, "mae-access", "charts", endpoint, "/module", "/charts");
        DeploymentTarget target = new DeploymentTarget(2L, "environment", endpoint);
        List<String> commands = new ArrayList<>();
        Map<String, DeploymentPreparation> preparations = new LinkedHashMap<>();
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
                return new RemoteOperationResult(1, "unexpected command");
            }

            @Override
            public String readText(RemoteEndpoint ignored, String path) {
                if (path.endsWith("/values.yaml") && !path.equals("/module/values.yaml")) return "replicas: 1\n";
                if (path.endsWith("/Chart.yaml")) return "name: svc\nversion: 1.0.0\n";
                if (path.equals("/module/values.yaml")) return "";
                throw new IllegalArgumentException(path);
            }

            @Override
            public List<String> listDirectories(RemoteEndpoint ignored, String path) {
                return List.of();
            }

            @Override
            public List<String> listFiles(RemoteEndpoint ignored, String path) {
                return List.of();
            }

            @Override
            public void upload(RemoteEndpoint ignored, String directory, Map<String, byte[]> files) {
            }
        };
        DeploymentPreparationStore store = new DeploymentPreparationStore() {
            @Override
            public void create(DeploymentPreparation preparation) {
                preparations.put(preparation.id(), preparation);
            }

            @Override
            public DeploymentPreparation get(String id) {
                return preparations.get(id);
            }

            @Override
            public void emit(String id, String stage, String service, String message) {
            }

            @Override
            public List<DeploymentEvent> events(String id) {
                return List.of();
            }

            @Override
            public Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener) {
                return () -> { };
            }
        };
        DeploymentRuntimeSettings runtime = new DeploymentRuntimeSettings() {
            public String kubectlKubeconfig() { return "/kubectl"; }
            public String helmKubeconfig() { return "/helm"; }
            public String lockFile() { return "/lock.json"; }
            public String jarListFile() { return "/jarlist.json"; }
        };
        DeploymentApplicationService service = new DeploymentApplicationService(
                context, remote, null, store, runtime, new ObjectMapper(), Runnable::run);

        DeploymentPreparation result = service.create(
                new CreateDeploymentPreparationCommand(1L, 2L, "mae", List.of("svc")));

        assertThat(commands).isEmpty();
        assertThat(result.service("svc").stage()).isEqualTo(DeploymentStage.ANALYZED);
        assertThat(result.service("svc").errors()).isEmpty();
    }
}
