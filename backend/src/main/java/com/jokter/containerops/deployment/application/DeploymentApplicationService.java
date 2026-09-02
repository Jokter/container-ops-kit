package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;
import com.jokter.containerops.deployment.domain.model.DeploymentStage;
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
public class DeploymentApplicationService {
    private static final String POD_RUNTIME_TEMPLATE = "'{{range .items}}{{if not .metadata.deletionTimestamp}}{{$pod := .}}{{range .status.containerStatuses}}{{printf \"%s\\t%s\\t%s\\t%t\\t%s\\n\" $pod.metadata.name .name $pod.status.phase .ready .imageID}}{{end}}{{end}}{{end}}'";
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
    private final DeploymentPreparationStore store;
    private final DeploymentRuntimeSettings runtime;
    private final EnvironmentVersionResolver versions;
    private final Executor executor;
    private final String kubectl;
    private final String helmCommand;
    private final ChartPreparationService charts = new ChartPreparationService();

    public DeploymentApplicationService(
            DeploymentContextPort context,
            DeploymentRemotePort remote,
            ChartWorkspacePort workspace,
            DeploymentPreparationStore store,
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
        List<String> services = List.of();
        if (namespace != null && !namespace.isBlank()) {
            if (!namespaces.contains(namespace)) throw new IllegalStateException("命名空间不存在：" + namespace);
            RemoteOperationResult pods = capture(target.endpoint(), podRuntimeCommand(namespace),
                    120000, null, "candidates");
            requireSuccess(pods, "命名空间 Pod 读取失败");
            services = versions.availableServices(buildServices, versions.runtimeContainers(pods.output()));
        }
        return new DeploymentCandidates(artifact.module(), services, namespaces);
    }

    public DeploymentPreparation create(CreateDeploymentPreparationCommand command) {
        DeploymentArtifact artifact = context.artifact(command.artifactId());
        context.target(command.environmentId());
        DeploymentPreparation preparation = DeploymentPreparation.create(
                UUID.randomUUID().toString(), command.artifactId(), command.environmentId(), artifact.module(), command.namespace(), command.services());
        store.create(preparation);
        store.emit(preparation.id(), "ANALYZE", null, "部署准备已创建");
        CompletableFuture.runAsync(() -> analyze(preparation, artifact), executor);
        return preparation;
    }

    public DeploymentPreparation get(String id) {
        return store.get(id);
    }

    public void updateValues(String id, String service, String values) {
        DeploymentPreparation preparation = store.get(id);
        preparation.updateValues(service, values);
        store.emit(id, "EDIT", service, "values.yaml 已更新，需重新生成和渲染");
    }

    public void apply(String id) {
        DeploymentPreparation preparation = store.get(id);
        DeploymentArtifact artifact = context.artifact(preparation.artifactId());
        for (Map.Entry<String, PreparedService> entry : preparation.services().entrySet()) {
            if (entry.getValue() == null || entry.getValue().stage() != DeploymentStage.ANALYZED) continue;
            try {
                PreparedService prepared = entry.getValue();
                PreparedService writable = new PreparedService(
                        prepared.service(), prepared.values(), prepared.chart(), templates(artifact, prepared.service()),
                        prepared.replaceItems(), prepared.unresolvedImages(), prepared.errors());
                workspace.write(id, writable);
                preparation.generated(entry.getKey());
                store.emit(id, "APPLY", entry.getKey(), "Chart 已生成到本地工作目录");
            } catch (RuntimeException exception) {
                store.emit(id, "APPLY", entry.getKey(), failure(exception));
            }
        }
    }

    public void render(String id) {
        DeploymentPreparation preparation = store.get(id);
        DeploymentTarget target = context.target(preparation.environmentId());
        for (Map.Entry<String, PreparedService> entry : preparation.services().entrySet()) {
            String service = entry.getKey();
            PreparedService prepared = entry.getValue();
            if (prepared == null || prepared.stage() != DeploymentStage.GENERATED) continue;
            try {
                String remoteDirectory = upload(preparation, target, service);
                RemoteOperationResult result = helm(target.endpoint(), "template " + q(service) + " " + q(remoteDirectory)
                        + " -f " + q(remoteDirectory + "/values.yaml") + " -n " + q(preparation.namespace()), 120000, id, service);
                preparation.rendered(service, result.succeeded(), result.succeeded() ? null : tail(result.output(), 1000));
                store.emit(id, "RENDER", service, result.succeeded() ? "Helm 渲染校验通过" : "Helm 渲染校验失败");
            } catch (RuntimeException exception) {
                preparation.rendered(service, false, failure(exception));
                store.emit(id, "RENDER", service, failure(exception));
            }
        }
    }

    public String confirmation(String id) {
        DeploymentPreparation preparation = store.get(id);
        context.artifact(preparation.artifactId());
        return preparation.issueConfirmation();
    }

    public void deploy(String id, long revision, String token) {
        DeploymentPreparation preparation = store.get(id);
        context.artifact(preparation.artifactId());
        preparation.authorizeDeployment(revision, token);
        DeploymentTarget target = context.target(preparation.environmentId());
        CompletableFuture.runAsync(() -> deploySerial(preparation, target), executor);
    }

    private void analyze(DeploymentPreparation preparation, DeploymentArtifact artifact) {
        DeploymentTarget target = context.target(preparation.environmentId());
        String global;
        try {
            global = remote.readText(artifact.buildEndpoint(), artifact.remoteModuleRoot() + "/values.yaml");
        } catch (RuntimeException exception) {
            for (String service : preparation.services().keySet()) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                preparation.analyzed(service, failed);
                store.emit(preparation.id(), "ANALYZE", service, failure(exception));
            }
            return;
        }
        Map<String, ChartSource> sources = new LinkedHashMap<>();
        for (String service : preparation.services().keySet()) {
            try {
                store.emit(preparation.id(), "ANALYZE", service, "正在读取待补全配置");
                sources.put(service, source(artifact, service, global));
            } catch (RuntimeException exception) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                preparation.analyzed(service, failed);
                store.emit(preparation.id(), "ANALYZE", service, failure(exception));
            }
        }
        if (sources.isEmpty()) return;
        DeploymentEnvironment environment;
        try {
            environment = environment(preparation, target, AnalysisRequirements.from(sources.values()));
        } catch (RuntimeException exception) {
            for (String service : sources.keySet()) {
                preparation.analyzed(service, new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception))));
                store.emit(preparation.id(), "ANALYZE", service, "OM 环境采集失败：" + failure(exception));
            }
            return;
        }
        for (Map.Entry<String, ChartSource> entry : sources.entrySet()) {
            String service = entry.getKey();
            try {
                ChartSource source = entry.getValue();
                AnalysisRequirements requirements = AnalysisRequirements.from(List.of(source));
                ServiceRuntimeIdentity identity = requirements.runtimeContainers() ? versions.runtimeIdentity(source.values()) : null;
                EnvironmentSnapshot snapshot = serviceSnapshot(preparation, target, environment, service, identity, requirements);
                PreparedChart chart = charts.prepare(service, source, snapshot);
                preparation.analyzed(service, new PreparedService(service, chart.values(), chart.chart(), chart.templates(), chart.replaceItems(), chart.unresolvedImages(), chart.errors()));
                store.emit(preparation.id(), "ANALYZE", service, chart.errors().isEmpty() ? "自动补全完成" : String.join("；", chart.errors()));
            } catch (RuntimeException exception) {
                PreparedService failed = new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception)));
                preparation.analyzed(service, failed);
                store.emit(preparation.id(), "ANALYZE", service, failure(exception));
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
            DeploymentPreparation preparation,
            DeploymentTarget target,
            AnalysisRequirements requirements
    ) {
        String namespace = preparation.namespace();
        String architecture = null;
        if (requirements.packageVersions()) {
            store.emit(preparation.id(), "ANALYZE", "环境采集", "读取运行架构");
            RemoteOperationResult result = capture(target.endpoint(), "uname -m", 120000, preparation.id(), "环境采集");
            requireSuccess(result, "环境架构读取失败");
            architecture = versions.architecture(result.output());
        }
        List<RuntimeContainer> containers = List.of();
        if (requirements.runtimeContainers()) {
            store.emit(preparation.id(), "ANALYZE", "环境采集", "读取服务运行实例");
            RemoteOperationResult result = capture(target.endpoint(), podRuntimeCommand(namespace), 120000, preparation.id(), "环境采集");
            requireSuccess(result, "命名空间 Pod 读取失败");
            containers = versions.runtimeContainers(result.output());
        }
        HelmEnvironmentValues helm = requirements.helmValues()
                ? helmEnvironment(target.endpoint(), namespace, preparation.module(), preparation.id())
                : new HelmEnvironmentValues(Map.of(), Map.of());
        return new DeploymentEnvironment(architecture, helm.placeholderVersions(), helm.globalOverrides(), containers);
    }

    private EnvironmentSnapshot serviceSnapshot(
            DeploymentPreparation preparation,
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
        store.emit(preparation.id(), "ANALYZE", service,
                "读取 Pod " + container.pod() + " / 容器 " + container.container() + " 的版本信息");
        String exec = kubectl + " exec -n " + q(preparation.namespace()) + " " + q(container.pod())
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
                120000, preparation.id(), service);
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

    private void deploySerial(DeploymentPreparation preparation, DeploymentTarget target) {
        for (String service : preparation.services().keySet()) {
            try {
                preparation.deploying(service);
                store.emit(preparation.id(), "DEPLOY", service, "[1/5] 再次执行渲染校验");
                String directory = upload(preparation, target, service);
                RemoteOperationResult rendered = helm(target.endpoint(), "template " + q(service) + " " + q(directory) + " -f "
                        + q(directory + "/values.yaml") + " -n " + q(preparation.namespace()), 120000, preparation.id(), service);
                requireSuccess(rendered, "渲染校验失败");
                store.emit(preparation.id(), "DEPLOY", service, "[2/5] 卸载旧 release");
                requireSuccess(execute(target.endpoint(), "if " + helmCommand + " status " + q(service) + " -n " + q(preparation.namespace())
                        + " >/dev/null 2>&1; then " + helmCommand + " uninstall " + q(service) + " -n " + q(preparation.namespace()) + "; fi", 180000, preparation.id(), service), "旧 release 卸载失败");
                store.emit(preparation.id(), "DEPLOY", service, "[3/5] 释放其它 release 占用的同名资源");
                releaseConflicts(target.endpoint(), preparation, service, rendered.output());
                store.emit(preparation.id(), "DEPLOY", service, "[4/5] 安装 Helm release");
                RemoteOperationResult installed = helm(target.endpoint(), "install " + q(service) + " " + q(directory) + " -f "
                        + q(directory + "/values.yaml") + " -n " + q(preparation.namespace()), 300000, preparation.id(), service);
                requireSuccess(installed, "安装失败");
                store.emit(preparation.id(), "DEPLOY", service, "[5/5] 等待工作负载就绪");
                waitReady(target.endpoint(), preparation, service);
                preparation.deployed(service, true, null);
                store.emit(preparation.id(), "DEPLOY", service, "部署成功");
            } catch (RuntimeException exception) {
                preparation.deployed(service, false, failure(exception));
                store.emit(preparation.id(), "DEPLOY", service, "部署失败：" + failure(exception));
            }
        }
    }

    private String upload(DeploymentPreparation preparation, DeploymentTarget target, String service) {
        String directory = "/tmp/container-ops-kit/" + preparation.id() + "/" + service;
        execute(target.endpoint(), "rm -rf " + q(directory) + " && mkdir -p " + q(directory), 120000, preparation.id(), service);
        remote.upload(target.endpoint(), directory, workspace.files(preparation.id(), service));
        return directory;
    }

    private void releaseConflicts(RemoteEndpoint endpoint, DeploymentPreparation preparation, String release, String rendered) {
        Matcher matcher = RESOURCE.matcher(rendered);
        Set<String> seen = new LinkedHashSet<>();
        while (matcher.find()) {
            String kind = matcher.group(1).trim();
            String name = matcher.group(2).trim();
            String resource = GROUP_KINDS.getOrDefault(kind, kind.toLowerCase());
            if (!seen.add(resource + "/" + name)) continue;
            String owner = execute(endpoint, kubectl + " get " + q(resource) + " " + q(name) + " -n " + q(preparation.namespace())
                    + " -o jsonpath='{.metadata.annotations.meta\\.helm\\.sh/release-name}' 2>/dev/null || true", 120000, preparation.id(), release).output().trim();
            if (!owner.isBlank() && !owner.equals(release)) {
                requireSuccess(execute(endpoint, kubectl + " delete " + q(resource) + " " + q(name) + " -n "
                        + q(preparation.namespace()) + " --ignore-not-found", 120000, preparation.id(), release), "冲突资源删除失败");
            }
        }
    }

    private void waitReady(RemoteEndpoint endpoint, DeploymentPreparation preparation, String service) {
        long deadline = System.nanoTime() + Duration.ofMinutes(10).toNanos();
        while (System.nanoTime() < deadline) {
            String command = "for t in deployment statefulset; do " + kubectl + " get $t " + q(service) + " -n " + q(preparation.namespace())
                    + " -o jsonpath='{.status.readyReplicas}/{.status.replicas}' 2>/dev/null && exit 0; done; exit 1";
            RemoteOperationResult result = execute(endpoint, command, 120000, preparation.id(), service);
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
