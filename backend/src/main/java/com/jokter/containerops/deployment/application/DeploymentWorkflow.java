package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.deployment.domain.model.DeploymentTask;
import com.jokter.containerops.deployment.domain.model.DeploymentMode;
import com.jokter.containerops.deployment.domain.model.DeploymentStage;
import com.jokter.containerops.deployment.domain.model.DeploymentTaskStatus;
import com.jokter.containerops.deployment.domain.model.PreparedService;
import com.jokter.containerops.deployment.domain.service.ChartPreparationService;
import com.jokter.containerops.deployment.domain.service.ChartSource;
import com.jokter.containerops.deployment.domain.service.EnvironmentSnapshot;
import com.jokter.containerops.deployment.domain.service.PreparedChart;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
final class DeploymentWorkflow {
    private static final String POD_RUNTIME_TEMPLATE = "'{{range .items}}{{if not .metadata.deletionTimestamp}}{{$pod := .}}{{range .status.containerStatuses}}{{printf \"%s\\t%s\\t%s\\t%t\\t%s\\n\" $pod.metadata.name .name $pod.status.phase .ready .imageID}}{{end}}{{end}}{{end}}'";
    private static final String WORKLOAD_TEMPLATE = "'{{range .items}}{{printf \"%s\\t%s\\n\" .kind .metadata.name}}{{end}}'";
    private static final String LOCK_MARKER = "__COK_LOCK__";
    private static final String JAR_MARKER = "__COK_JAR__";
    private static final Pattern RESOURCE = Pattern.compile("(?ms)^kind:\\s*([^\\s]+).*?^metadata:\\s*\\n(?:^[ \\t]+.*\\n)*?^[ \\t]+name:\\s*([^\\s#]+)");
    private static final Map<String, String> GROUP_KINDS = Map.ofEntries(
            Map.entry("BeidouLog", "beidoulog"),
            Map.entry("DrPodAutoscaler", "drpodautoscaler"),
            Map.entry("MqsClient", "mqsclient"),
            Map.entry("SOPPub", "soppub"),
            Map.entry("SopSecret", "sopsecret"),
            Map.entry("ResourceClaim", "resourceclaim.resource.sop.huawei.com"),
            Map.entry("LogResourceClaim", "logresourceclaim.resource.sop.huawei.com")
    );
    private final DeploymentContextPort context;
    private final DeploymentRemotePort remote;
    private final ChartWorkspacePort workspace;
    private final DeploymentTaskStore store;
    private final DeploymentRuntimeSettings runtime;
    private final EnvironmentVersionResolver versions;
    private final Executor executor;
    private final String kubectl;
    private final String helmCommand;
    private final ChartPreparationService charts = new ChartPreparationService();

    DeploymentWorkflow(
            DeploymentContextPort context,
            DeploymentRemotePort remote,
            ChartWorkspacePort workspace,
            DeploymentTaskStore store,
            DeploymentRuntimeSettings runtime,
            ObjectMapper objectMapper,
            @Qualifier("buildExecutor") Executor executor
    ) {
        this.context = context;
        this.remote = remote;
        this.workspace = workspace;
        this.store = store;
        this.runtime = runtime;
        this.versions = new EnvironmentVersionResolver(objectMapper);
        this.executor = executor;
        this.kubectl = "kubectl --kubeconfig=" + q(runtime.kubectlKubeconfig());
        this.helmCommand = "helm --kubeconfig=" + q(runtime.helmKubeconfig());
    }

    public DeploymentCandidates candidates(Long artifactId, Long environmentId, String namespace) {
        DeploymentArtifact artifact = context.artifact(artifactId);
        DeploymentTarget target = context.target(environmentId);
        List<String> buildServices = remote.listDirectories(artifact.buildEndpoint(), artifact.remoteChartsRoot());
        RemoteOperationResult result = execute(target.endpoint(),
                kubectl + " get namespaces --no-headers -o custom-columns=NAME:.metadata.name 2>&1",
                120000, null, "candidates");
        requireSuccess(result, "命名空间读取失败");
        List<String> namespaces = lines(result.output());
        if (namespaces.isEmpty()) throw new IllegalStateException("命名空间读取结果为空");
        List<DeploymentWorkloadCandidate> workloads = List.of();
        if (namespace != null && !namespace.isBlank()) {
            if (!namespaces.contains(namespace)) throw new IllegalStateException("命名空间不存在：" + namespace);
            RemoteOperationResult pods = capture(target.endpoint(), podRuntimeCommand(namespace),
                    120000, null, "candidates");
            requireSuccess(pods, "命名空间 Pod 读取失败");
            List<String> availableServices = versions.availableServices(buildServices, versions.runtimeContainers(pods.output()));
            RemoteOperationResult workloadResult = capture(target.endpoint(), kubectl + " get deployment,statefulset -n " + q(namespace)
                            + " -o go-template=" + WORKLOAD_TEMPLATE,
                    120000, null, "candidates");
            requireSuccess(workloadResult, "命名空间工作负载读取失败");
            Map<String, WorkloadKind> workloadKinds = new LinkedHashMap<>();
            workloadResult.output().lines()
                    .filter(line -> !line.isBlank())
                    .forEach(line -> {
                        String[] columns = line.split("\\t", -1);
                        if (columns.length != 2 || columns[1].isBlank()) {
                            throw new IllegalStateException("工作负载列表格式不正确：" + line);
                        }
                        workloadKinds.put(columns[1], WorkloadKind.fromKubernetesKind(columns[0]));
                    });
            workloads = availableServices.stream()
                    .map(service -> new DeploymentWorkloadCandidate(
                            service, workloadKinds.getOrDefault(service, WorkloadKind.UNKNOWN), true))
                    .toList();
        }
        return new DeploymentCandidates(artifact.module(), workloads, namespaces);
    }

    DeploymentTask start(CreateDeploymentTaskCommand command) {
        DeploymentArtifact artifact = context.artifact(command.artifactId());
        context.target(command.environmentId());
        DeploymentTask task = DeploymentTask.create(
                UUID.randomUUID().toString(), command.mode(), command.artifactId(), command.environmentId(), artifact.module(), command.namespace(), command.services());
        store.create(task);
        store.emit(task.id(), "ANALYZE", null, "部署任务已创建");
        CompletableFuture.runAsync(() -> {
            task.beginAnalysis();
            analyze(task, artifact);
            if (command.mode() == DeploymentMode.QUICK && task.status() == DeploymentTaskStatus.ANALYZING) {
                task.beginAutomaticExecution();
                prepareAndDeploy(task);
            }
        }, executor);
        return task;
    }

    DeploymentTask get(String id) {
        return store.get(id);
    }

    void updateValues(String id, String service, String values) {
        DeploymentTask task = store.get(id);
        task.updateValues(service, values);
        store.emit(id, "EDIT", service, "values.yaml 已更新，需重新生成和渲染");
    }

    DeploymentTask continueAfterReview(String id, long expectedRevision) {
        DeploymentTask task = store.get(id);
        context.artifact(task.artifactId());
        if (task.beginReviewedExecution(expectedRevision)) {
            CompletableFuture.runAsync(() -> prepareAndDeploy(task), executor);
        }
        return task;
    }

    private void prepareAndDeploy(DeploymentTask task) {
        apply(task.id());
        if (task.services().values().stream().anyMatch(service -> service == null || service.stage() != DeploymentStage.GENERATED)) {
            task.finishExecution();
            return;
        }
        render(task.id());
        if (task.services().values().stream().anyMatch(service -> service.stage() != DeploymentStage.RENDERED)) {
            task.finishExecution();
            return;
        }
        deploySerial(task, context.target(task.environmentId()));
    }

    private void apply(String id) {
        DeploymentTask task = store.get(id);
        DeploymentArtifact artifact = context.artifact(task.artifactId());
        for (Map.Entry<String, PreparedService> entry : task.services().entrySet()) {
            if (entry.getValue() == null || entry.getValue().stage() != DeploymentStage.ANALYZED) continue;
            try {
                PreparedService prepared = entry.getValue();
                PreparedService writable = new PreparedService(
                        prepared.service(), prepared.values(), prepared.chart(), templates(artifact, prepared.service()),
                        prepared.replaceItems(), prepared.unresolvedImages(), prepared.errors());
                workspace.write(id, writable);
                task.generated(entry.getKey());
                store.emit(id, "APPLY", entry.getKey(), "Chart 已生成到本地工作目录");
            } catch (RuntimeException exception) {
                String error = failure(exception);
                task.generationFailed(entry.getKey(), error);
                store.emit(id, "APPLY", entry.getKey(), error);
            }
        }
    }

    private void render(String id) {
        DeploymentTask task = store.get(id);
        DeploymentTarget target = context.target(task.environmentId());
        for (Map.Entry<String, PreparedService> entry : task.services().entrySet()) {
            String service = entry.getKey();
            PreparedService prepared = entry.getValue();
            if (prepared == null || prepared.stage() != DeploymentStage.GENERATED) continue;
            try {
                String remoteDirectory = upload(task, target, service);
                RemoteOperationResult result = helm(target.endpoint(), "template " + q(service) + " " + q(remoteDirectory)
                        + " -f " + q(remoteDirectory + "/values.yaml") + " -n " + q(task.namespace()), 120000, id, service);
                task.rendered(service, result.succeeded(), result.succeeded() ? null : tail(result.output(), 1000));
                store.emit(id, "RENDER", service, result.succeeded() ? "Helm 渲染校验通过" : "Helm 渲染校验失败");
            } catch (RuntimeException exception) {
                task.rendered(service, false, failure(exception));
                store.emit(id, "RENDER", service, failure(exception));
            }
        }
    }

    private void analyze(DeploymentTask task, DeploymentArtifact artifact) {
        DeploymentTarget target = context.target(task.environmentId());
        String global;
        try {
            global = remote.readText(artifact.buildEndpoint(), artifact.remoteModuleRoot() + "/values.yaml");
        } catch (RuntimeException exception) {
            for (String service : task.services().keySet()) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                task.analyzed(service, failed);
                store.emit(task.id(), "ANALYZE", service, failure(exception));
            }
            return;
        }
        Map<String, ChartSource> sources = new LinkedHashMap<>();
        for (String service : task.services().keySet()) {
            try {
                store.emit(task.id(), "ANALYZE", service, "正在读取待补全配置");
                sources.put(service, source(artifact, service, global));
            } catch (RuntimeException exception) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                task.analyzed(service, failed);
                store.emit(task.id(), "ANALYZE", service, failure(exception));
            }
        }
        if (sources.isEmpty()) return;
        DeploymentEnvironment environment;
        try {
            environment = environment(task, target, AnalysisRequirements.from(sources.values()));
        } catch (RuntimeException exception) {
            for (String service : sources.keySet()) {
                task.analyzed(service, new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception))));
                store.emit(task.id(), "ANALYZE", service, "OM 环境采集失败：" + failure(exception));
            }
            return;
        }
        for (Map.Entry<String, ChartSource> entry : sources.entrySet()) {
            String service = entry.getKey();
            try {
                ChartSource source = entry.getValue();
                AnalysisRequirements requirements = AnalysisRequirements.from(List.of(source));
                ServiceRuntimeIdentity identity = requirements.runtimeContainers() ? versions.runtimeIdentity(source.values()) : null;
                EnvironmentSnapshot snapshot = serviceSnapshot(task, target, environment, service, identity, requirements);
                PreparedChart chart = charts.prepare(service, source, snapshot);
                task.analyzed(service, new PreparedService(service, chart.values(), chart.chart(), chart.templates(), chart.replaceItems(), chart.unresolvedImages(), chart.errors()));
                store.emit(task.id(), "ANALYZE", service, chart.errors().isEmpty() ? "自动补全完成" : String.join("；", chart.errors()));
            } catch (RuntimeException exception) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                task.analyzed(service, failed);
                store.emit(task.id(), "ANALYZE", service, failure(exception));
            }
        }
    }

    private ChartSource source(DeploymentArtifact artifact, String service, String global) {
        String serviceRoot = artifact.remoteChartsRoot() + "/" + service;
        String values = remote.readText(artifact.buildEndpoint(), serviceRoot + "/values.yaml");
        String chart = remote.readText(artifact.buildEndpoint(), serviceRoot + "/Chart.yaml");
        return new ChartSource(values, chart, global, Map.of());
    }

    private Map<String, String> templates(DeploymentArtifact artifact, String service) {
        String serviceRoot = artifact.remoteChartsRoot() + "/" + service;
        Map<String, String> templates = new LinkedHashMap<>();
        for (String file : remote.listFiles(artifact.buildEndpoint(), serviceRoot + "/templates")) {
            if (!file.startsWith("_")) templates.put(file, remote.readText(artifact.buildEndpoint(), serviceRoot + "/templates/" + file));
        }
        String moduleTemplates = artifact.remoteModuleRoot() + "/templates";
        for (String file : remote.listFiles(artifact.buildEndpoint(), moduleTemplates)) {
            if (file.startsWith("_")) templates.putIfAbsent(file, remote.readText(artifact.buildEndpoint(), moduleTemplates + "/" + file));
        }
        List<String> baseCandidates = List.of(
                artifact.remoteModuleRoot() + "/charts/" + artifact.module() + "-base-features-charts/templates",
                artifact.remoteModuleRoot() + "/charts/" + artifact.chartsPath().substring(0, artifact.chartsPath().indexOf('/')) + "/templates"
        );
        for (String baseTemplates : baseCandidates) {
            try {
                if (remote.listFiles(artifact.buildEndpoint(), baseTemplates).contains("_helpers.tpl")) {
                    templates.put("_helpers.tpl", remote.readText(artifact.buildEndpoint(), baseTemplates + "/_helpers.tpl"));
                    break;
                }
            } catch (RuntimeException ignored) {
            }
        }
        return templates;
    }

    private DeploymentEnvironment environment(
            DeploymentTask task,
            DeploymentTarget target,
            AnalysisRequirements requirements
    ) {
        String namespace = task.namespace();
        String architecture = null;
        if (requirements.packageVersions()) {
            store.emit(task.id(), "ANALYZE", "环境采集", "读取运行架构");
            RemoteOperationResult result = capture(target.endpoint(), "uname -m", 120000, task.id(), "环境采集");
            requireSuccess(result, "环境架构读取失败");
            architecture = versions.architecture(result.output());
        }
        List<RuntimeContainer> containers = List.of();
        if (requirements.runtimeContainers()) {
            store.emit(task.id(), "ANALYZE", "环境采集", "读取服务运行实例");
            RemoteOperationResult result = capture(target.endpoint(), podRuntimeCommand(namespace), 120000, task.id(), "环境采集");
            requireSuccess(result, "命名空间 Pod 读取失败");
            containers = versions.runtimeContainers(result.output());
        }
        HelmEnvironmentValues helm = requirements.helmValues()
                ? helmEnvironment(target.endpoint(), namespace, task.module(), task.id())
                : new HelmEnvironmentValues(Map.of(), Map.of());
        return new DeploymentEnvironment(architecture, helm.placeholderVersions(), helm.globalOverrides(), containers);
    }

    private EnvironmentSnapshot serviceSnapshot(
            DeploymentTask task,
            DeploymentTarget target,
            DeploymentEnvironment environment,
            String service,
            ServiceRuntimeIdentity identity,
            AnalysisRequirements requirements
    ) {
        if (!requirements.runtimeContainers()) {
            return new EnvironmentSnapshot(Map.of(), environment.placeholderVersions(), null, environment.globalOverrides());
        }
        RuntimeContainer container = versions.targetFor(identity, environment.containers());
        store.emit(task.id(), "ANALYZE", service,
                "读取 Pod " + container.pod() + " / 容器 " + container.container() + " 的版本信息");
        String exec = kubectl + " exec -n " + q(task.namespace()) + " " + q(container.pod())
                + " -c " + q(container.container()) + " -- ";
        StringBuilder script = new StringBuilder("set -e; ");
        if (requirements.packageVersions()) {
            script.append("printf '%s\\n' ").append(q(LOCK_MARKER)).append("; cat ").append(q(runtime.lockFile())).append("; ");
        }
        if (requirements.jarList()) {
            script.append("printf '\\n%s\\n' ").append(q(JAR_MARKER)).append("; test ! -r ")
                    .append(q(runtime.jarListFile())).append(" || cat ").append(q(runtime.jarListFile())).append("; ");
        }
        RemoteOperationResult result = capture(target.endpoint(), exec + "sh -c " + q(script.toString()),
                120000, task.id(), service);
        requireSuccess(result, service + " 容器版本信息读取失败");
        String output = result.output();
        String lock = requirements.packageVersions()
                ? section(output, LOCK_MARKER, requirements.jarList() ? JAR_MARKER : null)
                : null;
        String jars = requirements.jarList() ? section(output, JAR_MARKER, null) : null;
        Map<String, String> packageVersions = requirements.packageVersions()
                ? versions.packageVersions(lock, environment.architecture())
                : Map.of();
        return new EnvironmentSnapshot(packageVersions, environment.placeholderVersions(),
                jars == null || jars.isBlank() ? null : jars.trim(), environment.globalOverrides());
    }

    private HelmEnvironmentValues helmEnvironment(RemoteEndpoint endpoint, String namespace, String module, String id) {
        store.emit(id, "ANALYZE", "环境采集", "读取已部署 Helm 配置");
        RemoteOperationResult releaseResult = helmCaptured(endpoint, "list -n " + q(namespace) + " -q", 120000, id, "环境采集");
        requireSuccess(releaseResult, "Helm release 列表读取失败");
        String release = versions.releaseFor(module, lines(releaseResult.output()))
                .orElseThrow(() -> new IllegalStateException("未找到模块 " + module + " 对应的 Helm release"));
        RemoteOperationResult valueResult = helmCaptured(endpoint, "get values " + q(release) + " -a -n " + q(namespace) + " -o json",
                120000, id, "环境采集");
        requireSuccess(valueResult, "Helm values 读取失败");
        return versions.helmEnvironment(valueResult.output());
    }

    private void deploySerial(DeploymentTask task, DeploymentTarget target) {
        task.beginDeployment();
        for (String service : task.services().keySet()) {
            try {
                task.deploying(service);
                store.emit(task.id(), "DEPLOY", service, "[1/5] 再次执行渲染校验");
                String directory = upload(task, target, service);
                RemoteOperationResult rendered = helm(target.endpoint(), "template " + q(service) + " " + q(directory) + " -f "
                        + q(directory + "/values.yaml") + " -n " + q(task.namespace()), 120000, task.id(), service);
                requireSuccess(rendered, "渲染校验失败");
                store.emit(task.id(), "DEPLOY", service, "[2/5] 卸载旧 release");
                requireSuccess(execute(target.endpoint(), "if " + helmCommand + " status " + q(service) + " -n " + q(task.namespace())
                        + " >/dev/null 2>&1; then " + helmCommand + " uninstall " + q(service) + " -n " + q(task.namespace()) + "; fi", 180000, task.id(), service), "旧 release 卸载失败");
                store.emit(task.id(), "DEPLOY", service, "[3/5] 释放其它 release 占用的同名资源");
                releaseConflicts(target.endpoint(), task, service, rendered.output());
                store.emit(task.id(), "DEPLOY", service, "[4/5] 安装 Helm release");
                RemoteOperationResult installed = helm(target.endpoint(), "install " + q(service) + " " + q(directory) + " -f "
                        + q(directory + "/values.yaml") + " -n " + q(task.namespace()), 300000, task.id(), service);
                requireSuccess(installed, "安装失败");
                store.emit(task.id(), "DEPLOY", service, "[5/5] 等待工作负载就绪");
                waitReady(target.endpoint(), task, service);
                task.deployed(service, true, null);
                store.emit(task.id(), "DEPLOY", service, "部署成功");
            } catch (RuntimeException exception) {
                task.deployed(service, false, failure(exception));
                store.emit(task.id(), "DEPLOY", service, "部署失败：" + failure(exception));
            }
        }
        task.finishExecution();
    }

    private String upload(DeploymentTask task, DeploymentTarget target, String service) {
        String directory = "/tmp/container-ops-kit/" + task.id() + "/" + service;
        execute(target.endpoint(), "rm -rf " + q(directory) + " && mkdir -p " + q(directory), 120000, task.id(), service);
        remote.upload(target.endpoint(), directory, workspace.files(task.id(), service));
        return directory;
    }

    private void releaseConflicts(RemoteEndpoint endpoint, DeploymentTask task, String release, String rendered) {
        Matcher matcher = RESOURCE.matcher(rendered);
        Set<String> seen = new LinkedHashSet<>();
        while (matcher.find()) {
            String kind = matcher.group(1).trim();
            String name = matcher.group(2).trim();
            String resource = GROUP_KINDS.getOrDefault(kind, kind.toLowerCase());
            if (!seen.add(resource + "/" + name)) continue;
            String owner = execute(endpoint, kubectl + " get " + q(resource) + " " + q(name) + " -n " + q(task.namespace())
                    + " -o jsonpath='{.metadata.annotations.meta\\.helm\\.sh/release-name}' 2>/dev/null || true", 120000, task.id(), release).output().trim();
            if (!owner.isBlank() && !owner.equals(release)) {
                requireSuccess(execute(endpoint, kubectl + " delete " + q(resource) + " " + q(name) + " -n "
                        + q(task.namespace()) + " --ignore-not-found", 120000, task.id(), release), "冲突资源删除失败");
            }
        }
    }

    private void waitReady(RemoteEndpoint endpoint, DeploymentTask task, String service) {
        long deadline = System.nanoTime() + Duration.ofMinutes(10).toNanos();
        while (System.nanoTime() < deadline) {
            String command = "for t in deployment statefulset; do " + kubectl + " get $t " + q(service) + " -n " + q(task.namespace())
                    + " -o jsonpath='{.status.readyReplicas}/{.status.replicas}' 2>/dev/null && exit 0; done; exit 1";
            RemoteOperationResult result = execute(endpoint, command, 120000, task.id(), service);
            String ready = result.output().trim();
            if (result.succeeded() && ready.matches("([1-9][0-9]*)/\\1")) return;
            try {
                Thread.sleep(15000);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("等待就绪已取消");
            }
        }
        throw new IllegalStateException("等待工作负载就绪超时");
    }

    private RemoteOperationResult helm(RemoteEndpoint endpoint, String args, long timeout, String id, String service) {
        String sentinel = "__COK_EXIT_";
        RemoteOperationResult raw = execute(endpoint, helmCommand + " " + args + " 2>&1; printf '\\n" + sentinel + "%s\\n' $?", timeout, id, service);
        return helmResult(raw, sentinel);
    }

    private RemoteOperationResult helmCaptured(RemoteEndpoint endpoint, String args, long timeout, String id, String service) {
        String sentinel = "__COK_EXIT_";
        RemoteOperationResult raw = capture(endpoint, helmCommand + " " + args + " 2>&1; printf '\\n" + sentinel + "%s\\n' $?", timeout, id, service);
        return helmResult(raw, sentinel);
    }

    private RemoteOperationResult helmResult(RemoteOperationResult raw, String sentinel) {
        Matcher matcher = Pattern.compile(Pattern.quote(sentinel) + "(\\d+)").matcher(raw.output());
        int code = matcher.find() ? Integer.parseInt(matcher.group(1)) : raw.exitCode();
        return new RemoteOperationResult(code, raw.output().replaceAll("(?m)^" + sentinel + "\\d+\\s*$", "").stripTrailing());
    }

    private RemoteOperationResult execute(RemoteEndpoint endpoint, String command, long timeout, String id, String service) {
        return remote.execute(endpoint, command, timeout, line -> {
            if (id != null) store.emit(id, "LOG", service, line);
        });
    }

    private RemoteOperationResult capture(RemoteEndpoint endpoint, String command, long timeout, String id, String service) {
        long started = System.nanoTime();
        RemoteOperationResult result = remote.execute(endpoint, command, timeout, ignored -> { });
        if (id != null) {
            long elapsed = Duration.ofNanos(System.nanoTime() - started).toMillis();
            store.emit(id, "LOG", service, "远程数据采集完成，耗时 " + elapsed + "ms");
        }
        return result;
    }

    private String podRuntimeCommand(String namespace) {
        return kubectl + " get pods -n " + q(namespace) + " -o go-template=" + POD_RUNTIME_TEMPLATE;
    }

    private String section(String output, String startMarker, String endMarker) {
        int start = output.indexOf(startMarker);
        if (start < 0) throw new IllegalStateException("容器版本信息缺少分段标记：" + startMarker);
        start += startMarker.length();
        int end = endMarker == null ? output.length() : output.indexOf(endMarker, start);
        if (end < 0) throw new IllegalStateException("容器版本信息缺少分段标记：" + endMarker);
        return output.substring(start, end).trim();
    }

    private void requireSuccess(RemoteOperationResult result, String message) {
        if (!result.succeeded()) throw new IllegalStateException(message + "：" + tail(result.output(), 600));
    }

    private List<String> lines(String value) {
        return value.lines().map(String::trim).filter(item -> !item.isBlank()).toList();
    }

    private String q(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private String tail(String value, int length) {
        return value.length() <= length ? value : value.substring(value.length() - length);
    }

    private String failure(Throwable throwable) {
        return throwable.getMessage() == null ? throwable.getClass().getSimpleName() : throwable.getMessage();
    }
}
