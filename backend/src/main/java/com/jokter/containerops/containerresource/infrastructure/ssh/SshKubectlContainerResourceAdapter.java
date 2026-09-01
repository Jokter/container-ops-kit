package com.jokter.containerops.containerresource.infrastructure.ssh;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MappingIterator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.jokter.containerops.containerresource.application.ContainerResourceConflictException;
import com.jokter.containerops.containerresource.application.ContainerResourceRemotePort;
import com.jokter.containerops.containerresource.application.ContainerResourceTarget;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ObservedResource;
import com.jokter.containerops.containerresource.domain.model.ResourceChangePreview;
import com.jokter.containerops.containerresource.domain.model.ResourceChangeResult;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.containerresource.domain.model.ResourceSummary;
import com.jokter.containerops.containerresource.domain.model.ResourceTypeSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceResourceWorkspace;
import com.jokter.containerops.containerresource.domain.model.ServiceResources;
import com.jokter.containerops.containerresource.domain.model.ServiceSource;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;
import com.jokter.containerops.containerresource.domain.service.ServiceOwnershipResolver;
import com.jokter.containerops.containerresource.domain.service.ServiceResourceInventory;
import com.jokter.containerops.shared.infrastructure.ssh.SshEndpoint;
import com.jokter.containerops.shared.infrastructure.ssh.SshExecution;
import com.jokter.containerops.shared.infrastructure.ssh.SshRemoteOperations;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
class SshKubectlContainerResourceAdapter implements ContainerResourceRemotePort {
    private static final long TIMEOUT = 120000;
    private static final Duration DISCOVERY_TTL = Duration.ofMinutes(5);
    private static final Set<String> BUILT_IN_GROUPS = Set.of("", "apps", "autoscaling", "batch", "networking.k8s.io", "policy", "rbac.authorization.k8s.io", "storage.k8s.io", "discovery.k8s.io", "admissionregistration.k8s.io", "apiextensions.k8s.io", "coordination.k8s.io", "events.k8s.io", "scheduling.k8s.io", "node.k8s.io");

    private final SshRemoteOperations operations;
    private final ObjectMapper json;
    private final ObjectMapper yaml;
    private final ServiceOwnershipResolver ownership = new ServiceOwnershipResolver();
    private final Map<Long, DiscoveryCache> discovery = new ConcurrentHashMap<>();

    @Autowired
    SshKubectlContainerResourceAdapter(SshRemoteOperations operations, ObjectMapper json) {
        this(operations, json, new ObjectMapper(new YAMLFactory()));
    }

    SshKubectlContainerResourceAdapter(SshRemoteOperations operations, ObjectMapper json, ObjectMapper yaml) {
        this.operations = operations;
        this.json = json;
        this.yaml = yaml;
    }

    @Override
    public ServiceResourceWorkspace loadServices(ContainerResourceTarget target, String namespace, boolean refresh) {
        Inventory inventory = inventory(target, namespace, refresh);
        ServiceResourceInventory resolved = ownership.resolve(inventory.services(), inventory.resources().stream().map(ResourceSnapshot::observed).toList());
        return new ServiceResourceWorkspace(target.environmentId(), target.environmentName(), namespace, resolved.services(), resolved.groups());
    }

    @Override
    public List<ResourceTypeSummary> loadResourceTypes(ContainerResourceTarget target, boolean refresh) {
        DiscoveryCache cached = discovery.get(target.environmentId());
        if (!refresh && cached != null && cached.createdAt().plus(DISCOVERY_TTL).isAfter(Instant.now())) {
            return cached.types();
        }
        Set<String> schemas = openApiGroups(target);
        List<ResourceTypeSummary> types = new ArrayList<>();
        types.addAll(apiResources(target, "", "v1", "/api/v1", schemas));
        JsonNode groups = readJson(command(target, "kubectl get --raw /apis", Set.of(0))).path("groups");
        for (JsonNode group : groups) {
            String groupVersion = group.path("preferredVersion").path("groupVersion").asText();
            if (groupVersion.isBlank()) {
                continue;
            }
            int separator = groupVersion.indexOf('/');
            String groupName = groupVersion.substring(0, separator);
            String version = groupVersion.substring(separator + 1);
            types.addAll(apiResources(target, groupName, version, "/apis/" + groupVersion, schemas));
        }
        List<ResourceTypeSummary> result = types.stream()
                .filter(type -> !type.resource().contains("/"))
                .sorted(java.util.Comparator.comparing(ResourceTypeSummary::group).thenComparing(ResourceTypeSummary::resource))
                .toList();
        discovery.put(target.environmentId(), new DiscoveryCache(Instant.now(), result));
        return result;
    }

    @Override
    public ServiceResources loadServiceResources(ContainerResourceTarget target, String namespace, String serviceKey) {
        Inventory inventory = inventory(target, namespace, false);
        String serviceName = inventory.services().stream().filter(service -> service.key().equals(serviceKey)).map(ServiceSummary::name).findFirst().orElse(serviceKey);
        List<ResourceSummary> resources = inventory.resources().stream()
                .filter(snapshot -> belongsTo(snapshot, serviceKey))
                .map(ResourceSnapshot::summary)
                .sorted(java.util.Comparator.comparing(ResourceSummary::category).thenComparing(ResourceSummary::name))
                .toList();
        return new ServiceResources(serviceKey, serviceName, resources);
    }

    @Override
    public EditableResource readResource(ContainerResourceTarget target, ResourceCoordinates coordinates) {
        ObjectNode value = (ObjectNode) getResource(target, coordinates);
        String resourceVersion = value.path("metadata").path("resourceVersion").asText();
        boolean managedByHelm = "Helm".equals(value.path("metadata").path("labels").path("app.kubernetes.io/managed-by").asText())
                || "Helm".equals(value.path("metadata").path("annotations").path("app.kubernetes.io/managed-by").asText());
        sanitize(value);
        return new EditableResource(coordinates, writeYaml(value), resourceVersion, managedByHelm);
    }

    @Override
    public ResourceChangePreview previewUpdate(ContainerResourceTarget target, ResourceCoordinates coordinates, String value, String expectedResourceVersion) {
        String observed = resourceVersion(target, coordinates);
        verifyVersion(observed, expectedResourceVersion);
        String path = upload(target, value);
        try {
            command(target, "kubectl replace --dry-run=server -f " + SshRemoteOperations.quote(path) + " -o yaml", Set.of(0));
            String diff = command(target, "kubectl diff -f " + SshRemoteOperations.quote(path), Set.of(0, 1));
            List<String> warnings = readResource(target, coordinates).managedByHelm() ? List.of("该资源由 Helm 管理，后续 Helm 发布可能覆盖本次修改") : List.of();
            return new ResourceChangePreview(true, diff, observed, warnings);
        } finally {
            cleanup(target, path);
        }
    }

    @Override
    public ResourceChangeResult applyUpdate(ContainerResourceTarget target, ResourceCoordinates coordinates, String value, String expectedResourceVersion) {
        verifyVersion(resourceVersion(target, coordinates), expectedResourceVersion);
        String path = upload(target, value);
        try {
            command(target, "kubectl replace --dry-run=server -f " + SshRemoteOperations.quote(path) + " -o name", Set.of(0));
            verifyVersion(resourceVersion(target, coordinates), expectedResourceVersion);
            command(target, "kubectl replace -f " + SshRemoteOperations.quote(path) + " -o name", Set.of(0));
            EditableResource updated = readResource(target, coordinates);
            return new ResourceChangeResult(coordinates, updated.resourceVersion(), updated.yaml());
        } finally {
            cleanup(target, path);
        }
    }

    @Override
    public ResourceChangePreview previewCreate(ContainerResourceTarget target, String namespace, String serviceKey, String value) {
        String prepared = prepareCreate(value, namespace, serviceKey);
        String path = upload(target, prepared);
        try {
            command(target, "kubectl create --dry-run=server -f " + SshRemoteOperations.quote(path) + " -o name", Set.of(0));
            return new ResourceChangePreview(true, createdDiff(prepared), null, List.of());
        } finally {
            cleanup(target, path);
        }
    }

    @Override
    public ResourceChangeResult createResource(ContainerResourceTarget target, String namespace, String serviceKey, String value) {
        String prepared = prepareCreate(value, namespace, serviceKey);
        String path = upload(target, prepared);
        try {
            command(target, "kubectl create --dry-run=server -f " + SshRemoteOperations.quote(path) + " -o name", Set.of(0));
            command(target, "kubectl create -f " + SshRemoteOperations.quote(path) + " -o name", Set.of(0));
            ResourceCoordinates coordinates = coordinates(target, readYaml(prepared), namespace);
            EditableResource created = readResource(target, coordinates);
            return new ResourceChangeResult(coordinates, created.resourceVersion(), created.yaml());
        } finally {
            cleanup(target, path);
        }
    }

    private Inventory inventory(ContainerResourceTarget target, String namespace, boolean refresh) {
        List<ResourceTypeSummary> types = loadResourceTypes(target, refresh);
        List<String> releases = helmReleases(target, namespace);
        Map<String, Set<String>> manifestOwners = helmManifestOwners(target, namespace, releases);
        List<ResourceSnapshot> snapshots = new ArrayList<>();
        snapshots.addAll(resourceSnapshots(target, namespace, types, true, releases, manifestOwners));
        snapshots.addAll(resourceSnapshots(target, namespace, types, false, releases, manifestOwners));
        LinkedHashMap<String, ServiceSummary> services = new LinkedHashMap<>();
        releases.forEach(name -> services.put("helm:" + name, new ServiceSummary("helm:" + name, name, ServiceSource.HELM_RELEASE, "NORMAL", 0)));
        snapshots.stream().filter(ResourceSnapshot::workload).forEach(snapshot -> {
            String name = snapshot.item().path("metadata").path("name").asText();
            boolean alreadyKnown = services.values().stream().anyMatch(service -> service.name().equals(name));
            if (!alreadyKnown) {
                services.put("workload:" + name, new ServiceSummary("workload:" + name, name, ServiceSource.WORKLOAD, workloadStatus(snapshot.item()), 0));
            }
        });
        List<ResourceSnapshot> resolved = snapshots.stream().map(snapshot -> resolveLabels(snapshot, services.values())).toList();
        return new Inventory(List.copyOf(services.values()), resolved);
    }

    private List<ResourceSnapshot> resourceSnapshots(ContainerResourceTarget target, String namespace, List<ResourceTypeSummary> types, boolean namespaced, List<String> releases, Map<String, Set<String>> manifestOwners) {
        List<ResourceTypeSummary> selected = types.stream()
                .filter(type -> type.namespaced() == namespaced && type.verbs().contains("list") && !type.resource().equals("events"))
                .toList();
        if (selected.isEmpty()) {
            return List.of();
        }
        String resources = selected.stream().map(this::qualified).reduce((left, right) -> left + "," + right).orElseThrow();
        String namespaceArgument = namespaced ? " -n " + SshRemoteOperations.quote(namespace) : "";
        JsonNode items = readJson(command(target, "kubectl get " + resources + namespaceArgument + " -o json --ignore-not-found", Set.of(0))).path("items");
        Map<String, ResourceTypeSummary> byType = new HashMap<>();
        selected.forEach(type -> byType.put(groupVersion(type.group(), type.version()) + "/" + type.kind(), type));
        List<ResourceSnapshot> result = new ArrayList<>();
        for (JsonNode item : items) {
            ResourceTypeSummary type = byType.get(item.path("apiVersion").asText() + "/" + item.path("kind").asText());
            if (type != null) {
                result.add(snapshot(type, item, releases, manifestOwners));
            }
        }
        return result;
    }

    private List<ResourceTypeSummary> apiResources(ContainerResourceTarget target, String group, String version, String path, Set<String> schemas) {
        List<ResourceTypeSummary> result = new ArrayList<>();
        for (JsonNode resource : readJson(command(target, "kubectl get --raw " + SshRemoteOperations.quote(path), Set.of(0))).path("resources")) {
            Set<String> verbs = new HashSet<>();
            resource.path("verbs").forEach(verb -> verbs.add(verb.asText()));
            boolean custom = !BUILT_IN_GROUPS.contains(group) && !group.endsWith(".k8s.io") && !group.endsWith(".kubernetes.io");
            result.add(new ResourceTypeSummary(group, version, resource.path("name").asText(), resource.path("kind").asText(), resource.path("namespaced").asBoolean(), verbs, schemas.contains(groupVersion(group, version)), custom));
        }
        return result;
    }

    private Set<String> openApiGroups(ContainerResourceTarget target) {
        JsonNode paths = readJson(command(target, "kubectl get --raw /openapi/v3", Set.of(0))).path("paths");
        Set<String> groups = new HashSet<>();
        paths.fieldNames().forEachRemaining(path -> groups.add(path.replace("api/v1", "v1").replace("apis/", "")));
        return groups;
    }

    private List<String> helmReleases(ContainerResourceTarget target, String namespace) {
        String output = command(target, "helm list -n " + SshRemoteOperations.quote(namespace) + " -o json", Set.of(0));
        List<String> names = new ArrayList<>();
        readJson(output).forEach(release -> names.add(release.path("name").asText()));
        return names;
    }

    private Map<String, Set<String>> helmManifestOwners(ContainerResourceTarget target, String namespace, List<String> releases) {
        Map<String, Set<String>> owners = new HashMap<>();
        for (String release : releases) {
            String manifest = command(target, "helm get manifest " + SshRemoteOperations.quote(release) + " -n " + SshRemoteOperations.quote(namespace), Set.of(0));
            try {
                MappingIterator<JsonNode> documents = yaml.readerFor(JsonNode.class).readValues(manifest);
                documents.forEachRemaining(node -> {
                    if (node != null && node.has("kind") && node.path("metadata").has("name")) {
                        String reference = node.path("kind").asText() + "/" + node.path("metadata").path("name").asText();
                        owners.computeIfAbsent(reference, ignored -> new HashSet<>()).add("helm:" + release);
                    }
                });
            } catch (Exception exception) {
                throw new IllegalStateException("Helm 清单解析失败：" + release, exception);
            }
        }
        return owners;
    }

    private ResourceSnapshot snapshot(ResourceTypeSummary type, JsonNode item, List<String> releases, Map<String, Set<String>> manifestOwners) {
        String name = item.path("metadata").path("name").asText();
        Set<String> keys = new HashSet<>(manifestOwners.getOrDefault(type.kind() + "/" + name, Set.of()));
        String instance = item.path("metadata").path("labels").path("app.kubernetes.io/instance").asText();
        if (releases.contains(instance)) {
            keys.add("helm:" + instance);
        }
        return new ResourceSnapshot(type, item, keys);
    }

    private ResourceSnapshot resolveLabels(ResourceSnapshot snapshot, Iterable<ServiceSummary> services) {
        Set<String> keys = new HashSet<>(snapshot.serviceKeys());
        JsonNode labels = snapshot.item().path("metadata").path("labels");
        Set<String> candidates = new HashSet<>();
        candidates.add(labels.path("app.kubernetes.io/name").asText());
        candidates.add(labels.path("app").asText());
        candidates.add(labels.path("k8s-app").asText());
        for (ServiceSummary service : services) {
            if (candidates.contains(service.name())) {
                keys.add(service.key());
            }
        }
        return new ResourceSnapshot(snapshot.type(), snapshot.item(), keys);
    }

    private boolean belongsTo(ResourceSnapshot snapshot, String serviceKey) {
        return switch (serviceKey) {
            case "group:shared" -> snapshot.serviceKeys().size() > 1;
            case "group:unassigned" -> snapshot.serviceKeys().isEmpty() && snapshot.type().namespaced();
            case "group:cluster" -> !snapshot.type().namespaced();
            default -> snapshot.serviceKeys().size() == 1 && snapshot.serviceKeys().contains(serviceKey);
        };
    }

    private JsonNode getResource(ContainerResourceTarget target, ResourceCoordinates coordinates) {
        String namespace = coordinates.namespace().isBlank() ? "" : " -n " + SshRemoteOperations.quote(coordinates.namespace());
        return readJson(command(target, "kubectl get " + qualified(coordinates) + namespace + " " + SshRemoteOperations.quote(coordinates.name()) + " -o json", Set.of(0)));
    }

    private String resourceVersion(ContainerResourceTarget target, ResourceCoordinates coordinates) {
        return getResource(target, coordinates).path("metadata").path("resourceVersion").asText();
    }

    private void verifyVersion(String observed, String expected) {
        if (!observed.equals(expected)) {
            throw new ContainerResourceConflictException();
        }
    }

    private void sanitize(ObjectNode value) {
        value.remove("status");
        if (value.path("metadata") instanceof ObjectNode metadata) {
            metadata.remove(List.of("managedFields", "uid", "creationTimestamp", "generation", "selfLink"));
        }
    }

    private String prepareCreate(String value, String namespace, String serviceKey) {
        ObjectNode node = (ObjectNode) readYaml(value);
        ObjectNode metadata = node.withObject("/metadata");
        metadata.put("namespace", namespace);
        ObjectNode labels = metadata.withObject("/labels");
        String serviceName = serviceKey.contains(":") ? serviceKey.substring(serviceKey.indexOf(':') + 1) : serviceKey;
        labels.put("app.kubernetes.io/name", serviceName);
        return writeYaml(node);
    }

    private ResourceCoordinates coordinates(ContainerResourceTarget target, JsonNode node, String namespace) {
        String apiVersion = node.path("apiVersion").asText();
        int separator = apiVersion.indexOf('/');
        String group = separator < 0 ? "" : apiVersion.substring(0, separator);
        String version = separator < 0 ? apiVersion : apiVersion.substring(separator + 1);
        String kind = node.path("kind").asText();
        ResourceTypeSummary type = loadResourceTypes(target, false).stream()
                .filter(candidate -> candidate.group().equals(group) && candidate.version().equals(version) && candidate.kind().equals(kind))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("环境中不存在资源类型：" + apiVersion + " " + kind));
        return new ResourceCoordinates(group, version, type.resource(), type.namespaced() ? namespace : "", node.path("metadata").path("name").asText());
    }

    private String upload(ContainerResourceTarget target, String value) {
        String directory = "/tmp/container-ops-resource-" + UUID.randomUUID();
        operations.uploadFiles(endpoint(target), directory, Map.of("resource.yaml", value.getBytes(StandardCharsets.UTF_8)), TIMEOUT);
        return directory + "/resource.yaml";
    }

    private void cleanup(ContainerResourceTarget target, String path) {
        String directory = path.substring(0, path.lastIndexOf('/'));
        operations.execute(endpoint(target), "rm -rf -- " + SshRemoteOperations.quote(directory), TIMEOUT, ignored -> { });
    }

    private String command(ContainerResourceTarget target, String command, Set<Integer> acceptedExitCodes) {
        StringBuilder output = new StringBuilder();
        StringBuilder errors = new StringBuilder();
        SshExecution execution = operations.execute(endpoint(target), command, TIMEOUT, line -> {
            if (line.startsWith("[stderr] ")) {
                errors.append(line.substring(9)).append('\n');
            } else {
                output.append(line).append('\n');
            }
        });
        if (!acceptedExitCodes.contains(execution.exitCode())) {
            String detail = errors.isEmpty() ? output.toString().trim() : errors.toString().trim();
            throw new IllegalArgumentException(detail.isBlank() ? "远程命令执行失败" : detail);
        }
        return output.toString();
    }

    private JsonNode readJson(String value) {
        try {
            return json.readTree(value);
        } catch (Exception exception) {
            String detail = value.length() > 500 ? value.substring(0, 500) : value;
            throw new IllegalStateException("Kubernetes 返回内容解析失败：" + detail, exception);
        }
    }

    private JsonNode readYaml(String value) {
        try {
            return yaml.readTree(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("YAML 解析失败：" + exception.getMessage(), exception);
        }
    }

    private String writeYaml(JsonNode value) {
        try {
            return yaml.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalStateException("YAML 生成失败", exception);
        }
    }

    private String createdDiff(String value) {
        return value.lines().map(line -> "+ " + line).reduce((left, right) -> left + "\n" + right).orElse("");
    }

    private String qualified(ResourceTypeSummary type) {
        return type.group().isBlank() ? type.resource() : type.resource() + "." + type.group();
    }

    private String qualified(ResourceCoordinates coordinates) {
        return coordinates.group().isBlank() ? coordinates.resource() : coordinates.resource() + "." + coordinates.group();
    }

    private String groupVersion(String group, String version) {
        return group.isBlank() ? version : group + "/" + version;
    }

    private SshEndpoint endpoint(ContainerResourceTarget target) {
        return new SshEndpoint(target.host(), target.port(), target.username(), target.password());
    }

    private static String category(ResourceTypeSummary type) {
        if (Set.of("Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod").contains(type.kind())) return "WORKLOAD";
        if (Set.of("ConfigMap", "Secret").contains(type.kind())) return "CONFIGURATION";
        if (Set.of("Service", "Ingress", "NetworkPolicy").contains(type.kind())) return "NETWORK";
        return type.custom() ? "CUSTOM" : "OTHER";
    }

    private static String workloadStatus(JsonNode item) {
        int desired = item.path("status").path("replicas").asInt(item.path("spec").path("replicas").asInt(0));
        int ready = item.path("status").path("readyReplicas").asInt(0);
        return desired == 0 || desired == ready ? "NORMAL" : "ABNORMAL";
    }

    private record DiscoveryCache(Instant createdAt, List<ResourceTypeSummary> types) {
    }

    private record Inventory(List<ServiceSummary> services, List<ResourceSnapshot> resources) {
    }

    private record ResourceSnapshot(ResourceTypeSummary type, JsonNode item, Set<String> serviceKeys) {
        private ResourceSnapshot {
            serviceKeys = Set.copyOf(serviceKeys);
        }

        private boolean workload() {
            return Set.of("Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob").contains(type.kind());
        }

        private ObservedResource observed() {
            return new ObservedResource(type.group(), type.version(), type.resource(), item.path("metadata").path("name").asText(), !type.namespaced(), serviceKeys);
        }

        private ResourceSummary summary() {
            String status = workload() ? workloadStatus(item) : item.path("status").path("phase").asText("ACTIVE").toUpperCase();
            return new ResourceSummary(type.group(), type.version(), type.resource(), type.kind(), item.path("metadata").path("name").asText(), category(type), status, type.custom(), type.verbs().contains("update"));
        }
    }
}
