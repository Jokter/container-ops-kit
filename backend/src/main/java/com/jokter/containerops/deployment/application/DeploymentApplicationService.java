package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
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
    private static final String KUBECONFIG = "/opt/kubeconfig/kubeconfig.txt";
    private static final String HELM = "helm --kubeconfig=" + KUBECONFIG;
    private static final String KUBECTL = "kubectl --kubeconfig=" + KUBECONFIG;
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
    private final ObjectMapper objectMapper;
    private final Executor executor;
    private final ChartPreparationService charts = new ChartPreparationService();

    public DeploymentApplicationService(
            DeploymentContextPort context,
            DeploymentRemotePort remote,
            ChartWorkspacePort workspace,
            DeploymentPreparationStore store,
            ObjectMapper objectMapper,
            @Qualifier("buildExecutor") Executor executor
    ) {
        this.context = context;
        this.remote = remote;
        this.workspace = workspace;
        this.store = store;
        this.objectMapper = objectMapper;
        this.executor = executor;
    }

    public DeploymentCandidates candidates(Long artifactId, Long environmentId) {
        DeploymentArtifact artifact = context.artifact(artifactId);
        DeploymentTarget target = context.target(environmentId);
        List<String> services = remote.listDirectories(artifact.buildEndpoint(), artifact.remoteChartsRoot());
        RemoteOperationResult result = execute(target.endpoint(),
                KUBECTL + " get namespaces --no-headers -o custom-columns=NAME:.metadata.name 2>&1",
                120000, null, "candidates");
        requireSuccess(result, "命名空间读取失败");
        List<String> namespaces = lines(result.output());
        if (namespaces.isEmpty()) throw new IllegalStateException("命名空间读取结果为空");
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
        for (Map.Entry<String, PreparedService> entry : preparation.services().entrySet()) {
            if (entry.getValue() == null || entry.getValue().stage() != DeploymentStage.ANALYZED) continue;
            try {
                workspace.write(id, entry.getValue());
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
        EnvironmentSnapshot snapshot;
        try {
            snapshot = snapshot(preparation, target);
        } catch (RuntimeException exception) {
            for (String service : preparation.services().keySet()) {
                preparation.analyzed(service, new PreparedService(service, "", "", Map.of(), List.of(), Set.of(), List.of(failure(exception))));
                store.emit(preparation.id(), "ANALYZE", service, "OM 环境采集失败：" + failure(exception));
            }
            return;
        }
        for (String service : preparation.services().keySet()) {
            try {
                store.emit(preparation.id(), "ANALYZE", service, "正在读取构建产物和模板");
                ChartSource source = source(artifact, service);
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

    private ChartSource source(DeploymentArtifact artifact, String service) {
        String serviceRoot = artifact.remoteChartsRoot() + "/" + service;
        String values = remote.readText(artifact.buildEndpoint(), serviceRoot + "/values.yaml");
        String chart = remote.readText(artifact.buildEndpoint(), serviceRoot + "/Chart.yaml");
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
        String global = remote.readText(artifact.buildEndpoint(), artifact.remoteModuleRoot() + "/values.yaml");
        return new ChartSource(values, chart, global, templates);
    }

    private EnvironmentSnapshot snapshot(DeploymentPreparation preparation, DeploymentTarget target) {
        String namespace = preparation.namespace();
        String podCommand = KUBECTL + " get pods -n " + q(namespace) + " -o jsonpath='{.items[0].metadata.name}'";
        RemoteOperationResult podResult = execute(target.endpoint(), podCommand, 120000, preparation.id(), "环境采集");
        String pod = podResult.succeeded() ? podResult.output().trim() : "";
        Map<String, String> versions = Map.of();
        String jars = "";
        if (!pod.isBlank()) {
            versions = jsonMap(execute(target.endpoint(), KUBECTL + " exec -n " + q(namespace) + " " + q(pod)
                    + " -- cat /opt/pkg_version/lock.json", 120000, preparation.id(), "环境采集").output());
            jars = execute(target.endpoint(), KUBECTL + " exec -n " + q(namespace) + " " + q(pod)
                    + " -- cat /opt/pkg_version/jarlist.json", 120000, preparation.id(), "环境采集").output().trim();
        }
        Map<String, String> images = imageTags(execute(target.endpoint(), "crictl images -o json 2>/dev/null || crictl images 2>/dev/null", 120000, preparation.id(), "环境采集").output());
        if (versions.isEmpty() && !images.isEmpty()) {
            String fallback = images.values().iterator().next().replaceFirst("-(x86_64|aarch64|x86|aarch)$", "");
            Map<String, String> fallbackVersions = new LinkedHashMap<>();
            for (String component : List.of("cbb_engr", "turboplatformcbb", "turbobasecbb", "maeplatformcbb", "maeaccessjarcbb", "maeopen3rd")) {
                fallbackVersions.put(component, fallback);
            }
            versions = fallbackVersions;
            store.emit(preparation.id(), "ANALYZE", "环境采集", "未找到运行中 Pod，已使用环境镜像版本兜底");
        }
        Map<String, String> overrides = environmentOverrides(target.endpoint(), namespace, preparation.id());
        return new EnvironmentSnapshot(versions, images, jars, overrides);
    }

    private Map<String, String> environmentOverrides(RemoteEndpoint endpoint, String namespace, String id) {
        RemoteOperationResult releases = execute(endpoint, HELM + " list -n " + q(namespace) + " -q | head -n 1", 120000, id, "环境采集");
        String release = releases.output().trim();
        if (release.isBlank()) return Map.of();
        RemoteOperationResult values = execute(endpoint, HELM + " get values " + q(release) + " -a -n " + q(namespace) + " -o json", 120000, id, "环境采集");
        try {
            JsonNode global = objectMapper.readTree(values.output()).path("global");
            Map<String, String> result = new LinkedHashMap<>();
            copyValue(global, "nodePool", result, "nodePool");
            copyValue(global, "domains", result, "domains");
            copyValue(global.path("repo"), "address", result, "repo.address");
            return result;
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private void copyValue(JsonNode parent, String field, Map<String, String> result, String key) {
        JsonNode value = parent.path(field);
        if (!value.isMissingNode()) result.put(key, value.isContainerNode() ? value.toString() : value.asText());
    }

    private Map<String, String> jsonMap(String text) {
        try {
            JsonNode root = objectMapper.readTree(text);
            if (root.has("versions")) root = root.get("versions");
            return objectMapper.convertValue(root, new TypeReference<LinkedHashMap<String, String>>() {});
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private Map<String, String> imageTags(String text) {
        Map<String, String> result = new LinkedHashMap<>();
        try {
            for (JsonNode image : objectMapper.readTree(text).path("images")) {
                for (JsonNode tagNode : image.path("repoTags")) {
                    String tag = tagNode.asText();
                    int separator = tag.lastIndexOf(':');
                    if (separator < 0) continue;
                    String name = tag.substring(0, separator);
                    name = name.substring(name.lastIndexOf('/') + 1).replaceFirst("-(x86_64|aarch64|x86|aarch)$", "");
                    result.putIfAbsent(name, tag.substring(separator + 1));
                }
            }
        } catch (Exception ignored) {
        }
        if (result.isEmpty()) {
            text.lines().skip(1).forEach(line -> {
                String[] columns = line.trim().split("\\s+");
                if (columns.length < 2 || columns[0].equals("<none>") || columns[1].equals("<none>")) return;
                String name = columns[0].substring(columns[0].lastIndexOf('/') + 1).replaceFirst("-(x86_64|aarch64|x86|aarch)$", "");
                result.putIfAbsent(name, columns[1]);
            });
        }
        return result;
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
                requireSuccess(execute(target.endpoint(), "if " + HELM + " status " + q(service) + " -n " + q(preparation.namespace())
                        + " >/dev/null 2>&1; then " + HELM + " uninstall " + q(service) + " -n " + q(preparation.namespace()) + "; fi", 180000, preparation.id(), service), "旧 release 卸载失败");
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
            String owner = execute(endpoint, KUBECTL + " get " + q(resource) + " " + q(name) + " -n " + q(preparation.namespace())
                    + " -o jsonpath='{.metadata.annotations.meta\\.helm\\.sh/release-name}' 2>/dev/null || true", 120000, preparation.id(), release).output().trim();
            if (!owner.isBlank() && !owner.equals(release)) {
                requireSuccess(execute(endpoint, KUBECTL + " delete " + q(resource) + " " + q(name) + " -n "
                        + q(preparation.namespace()) + " --ignore-not-found", 120000, preparation.id(), release), "冲突资源删除失败");
            }
        }
    }

    private void waitReady(RemoteEndpoint endpoint, DeploymentPreparation preparation, String service) {
        long deadline = System.nanoTime() + Duration.ofMinutes(10).toNanos();
        while (System.nanoTime() < deadline) {
            String command = "for t in deployment statefulset; do " + KUBECTL + " get $t " + q(service) + " -n " + q(preparation.namespace())
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
        RemoteOperationResult raw = execute(endpoint, HELM + " " + args + " 2>&1; printf '\\n" + sentinel + "%s\\n' $?", timeout, id, service);
        Matcher matcher = Pattern.compile(Pattern.quote(sentinel) + "(\\d+)").matcher(raw.output());
        int code = matcher.find() ? Integer.parseInt(matcher.group(1)) : raw.exitCode();
        return new RemoteOperationResult(code, raw.output().replaceAll("(?m)^" + sentinel + "\\d+\\s*$", "").stripTrailing());
    }

    private RemoteOperationResult execute(RemoteEndpoint endpoint, String command, long timeout, String id, String service) {
        return remote.execute(endpoint, command, timeout, line -> {
            if (id != null) store.emit(id, "LOG", service, line);
        });
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
