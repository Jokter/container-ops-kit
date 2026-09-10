package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.deployment.domain.model.DeploymentTask;
import com.jokter.containerops.deployment.domain.model.DeploymentMode;
import com.jokter.containerops.deployment.domain.model.DeploymentStage;
import com.jokter.containerops.deployment.domain.model.DeploymentTaskStatus;
import com.jokter.containerops.deployment.domain.model.PreparedService;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

class DeploymentApplicationServiceTest {
    @Test
    void quickDeploymentRunsTheExistingWorkflowToCompletion() {
        RemoteEndpoint endpoint = new RemoteEndpoint("host", 22, "root", "password");
        DeploymentArtifact artifact = new DeploymentArtifact(1L, "mae-common", "charts/base", endpoint, "/module", "/charts");
        DeploymentTarget target = new DeploymentTarget(2L, "environment", endpoint);
        Map<String, DeploymentTask> preparations = new LinkedHashMap<>();
        DeploymentContextPort context = new DeploymentContextPort() {
            public DeploymentArtifact artifact(Long artifactId) { return artifact; }
            public DeploymentTarget target(Long environmentId) { return target; }
        };
        DeploymentRemotePort remote = new DeploymentRemotePort() {
            public RemoteOperationResult execute(RemoteEndpoint ignored, String command, long timeout, Consumer<String> output) {
                if (command.contains("get $t")) return new RemoteOperationResult(0, "1/1");
                if (command.contains("helm")) return new RemoteOperationResult(0, "__COK_EXIT_0\n");
                return new RemoteOperationResult(0, "");
            }
            public String readText(RemoteEndpoint ignored, String path) {
                if (path.equals("/module/values.yaml")) return "";
                if (path.endsWith("/values.yaml")) return "replicas: 1\n";
                if (path.endsWith("/Chart.yaml")) return "name: svc\nversion: 1.0.0\n";
                throw new IllegalArgumentException(path);
            }
            public List<String> listDirectories(RemoteEndpoint ignored, String path) { return List.of(); }
            public List<String> listFiles(RemoteEndpoint ignored, String path) { return List.of(); }
            public void upload(RemoteEndpoint ignored, String directory, Map<String, byte[]> files) { }
        };
        DeploymentTaskStore store = store(preparations);
        ChartWorkspacePort workspace = new ChartWorkspacePort() {
            public void write(String preparationId, PreparedService service) { }
            public Map<String, byte[]> files(String preparationId, String service) { return Map.of(); }
        };
        DeploymentApplicationService service = new DeploymentApplicationService(new DeploymentWorkflow(
                context, remote, workspace, store, runtime(), new ObjectMapper(), Runnable::run));

        DeploymentTask result = service.create(
                new CreateDeploymentTaskCommand(DeploymentMode.QUICK, 1L, 2L, "mae", List.of("svc")));

        assertThat(result.status()).isEqualTo(DeploymentTaskStatus.SUCCEEDED);
        assertThat(result.service("svc").stage()).isEqualTo(DeploymentStage.SUCCEEDED);
    }

    @Test
    void marksServiceFailedWhenChartGenerationFails() {
        RemoteEndpoint endpoint = new RemoteEndpoint("host", 22, "root", "password");
        DeploymentArtifact artifact = new DeploymentArtifact(1L, "mae-common", "charts", endpoint, "/module", "/charts");
        DeploymentTask preparation = DeploymentTask.create("preparation", DeploymentMode.REVIEW, 1L, 2L, "mae-common", "mae", List.of("demo-nginx"));
        preparation.beginAnalysis();
        preparation.analyzed("demo-nginx", PreparedService.success("demo-nginx", "image: nginx\n", "name: demo-nginx\n"));
        DeploymentContextPort context = new DeploymentContextPort() {
            public DeploymentArtifact artifact(Long artifactId) { return artifact; }
            public DeploymentTarget target(Long environmentId) { throw new UnsupportedOperationException(); }
        };
        DeploymentRemotePort remote = new DeploymentRemotePort() {
            public RemoteOperationResult execute(RemoteEndpoint ignored, String command, long timeout, Consumer<String> output) { throw new UnsupportedOperationException(); }
            public String readText(RemoteEndpoint ignored, String path) { throw new UnsupportedOperationException(); }
            public List<String> listDirectories(RemoteEndpoint ignored, String path) { throw new UnsupportedOperationException(); }
            public List<String> listFiles(RemoteEndpoint ignored, String path) { throw new IllegalStateException("模板目录不可读"); }
            public void upload(RemoteEndpoint ignored, String directory, Map<String, byte[]> files) { throw new UnsupportedOperationException(); }
        };
        DeploymentTaskStore store = new DeploymentTaskStore() {
            public void create(DeploymentTask value) { }
            public DeploymentTask get(String id) { return preparation; }
            public void emit(String id, String stage, String service, String message) { }
            public List<DeploymentEvent> events(String id) { return List.of(); }
            public Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener) { return () -> { }; }
        };
        DeploymentRuntimeSettings runtime = new DeploymentRuntimeSettings() {
            public String kubectlKubeconfig() { return "/kubectl"; }
            public String helmKubeconfig() { return "/helm"; }
            public String lockFile() { return "/lock.json"; }
            public String jarListFile() { return "/jarlist.json"; }
        };
        DeploymentApplicationService service = new DeploymentApplicationService(new DeploymentWorkflow(
                context, remote, null, store, runtime, new ObjectMapper(), Runnable::run));

        service.execute("preparation", 1L);

        assertThat(preparation.service("demo-nginx").stage()).isEqualTo(DeploymentStage.FAILED);
        assertThat(preparation.service("demo-nginx").stageError()).isEqualTo("模板目录不可读");
    }

    @Test
    void classifiesDeploymentsAndStatefulSetsByMatchingCharts() {
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
                if (command.contains("get pods")) {
                    return new RemoteOperationResult(0,
                            "fmproductfrontendservice-abc\tapp\tRunning\ttrue\timage\n"
                                    + "accesscommonds-abc\tapp\tRunning\ttrue\timage\n");
                }
                if (command.contains("get deployment,statefulset -n 'mae'")) {
                    return new RemoteOperationResult(0,
                            "Deployment\tfmproductfrontendservice\n"
                                    + "StatefulSet\taccesscommonds\n"
                                    + "Deployment\tdemo-nginx\n");
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
        DeploymentApplicationService service = new DeploymentApplicationService(new DeploymentWorkflow(
                context, remote, null, null, runtime, new ObjectMapper(), Runnable::run));

        DeploymentCandidates result = service.candidates(1L, 2L, "mae");

        assertThat(result.namespaces()).containsExactly("mae", "other");
        assertThat(result.workloads()).containsExactly(
                new DeploymentWorkloadCandidate("fmproductfrontendservice", WorkloadKind.DEPLOYMENT, true),
                new DeploymentWorkloadCandidate("accesscommonds", WorkloadKind.STATEFUL_SET, true)
        );
        assertThat(commands).allMatch(command -> command.startsWith("kubectl --kubeconfig='/custom/kubectl.conf'"));
        assertThat(commands).noneMatch(command -> command.contains("-o json"));
        assertThat(commands).anyMatch(command -> command.contains("get pods"));
        assertThat(commands).anyMatch(command -> command.contains("-o go-template="));
    }

    @Test
    void skipsOmCollectionWhenSourceFilesContainNoDynamicValues() {
        RemoteEndpoint endpoint = new RemoteEndpoint("host", 22, "root", "password");
        DeploymentArtifact artifact = new DeploymentArtifact(1L, "mae-access", "charts", endpoint, "/module", "/charts");
        DeploymentTarget target = new DeploymentTarget(2L, "environment", endpoint);
        List<String> commands = new ArrayList<>();
        Map<String, DeploymentTask> preparations = new LinkedHashMap<>();
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
        DeploymentTaskStore store = new DeploymentTaskStore() {
            @Override
            public void create(DeploymentTask preparation) {
                preparations.put(preparation.id(), preparation);
            }

            @Override
            public DeploymentTask get(String id) {
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
        DeploymentApplicationService service = new DeploymentApplicationService(new DeploymentWorkflow(
                context, remote, null, store, runtime, new ObjectMapper(), Runnable::run));

        DeploymentTask result = service.create(
                new CreateDeploymentTaskCommand(DeploymentMode.REVIEW, 1L, 2L, "mae", List.of("svc")));

        assertThat(commands).isEmpty();
        assertThat(result.service("svc").stage()).isEqualTo(DeploymentStage.ANALYZED);
        assertThat(result.service("svc").errors()).isEmpty();
        assertThat(result.status()).isEqualTo(DeploymentTaskStatus.AWAITING_REVIEW);
    }

    private DeploymentRuntimeSettings runtime() {
        return new DeploymentRuntimeSettings() {
            public String kubectlKubeconfig() { return "/kubectl"; }
            public String helmKubeconfig() { return "/helm"; }
            public String lockFile() { return "/lock.json"; }
            public String jarListFile() { return "/jarlist.json"; }
        };
    }

    private DeploymentTaskStore store(Map<String, DeploymentTask> preparations) {
        return new DeploymentTaskStore() {
            public void create(DeploymentTask value) { preparations.put(value.id(), value); }
            public DeploymentTask get(String id) { return preparations.get(id); }
            public void emit(String id, String stage, String service, String message) { }
            public List<DeploymentEvent> events(String id) { return List.of(); }
            public Runnable subscribe(String id, long afterSequence, Consumer<DeploymentEvent> listener) { return () -> { }; }
        };
    }
}
