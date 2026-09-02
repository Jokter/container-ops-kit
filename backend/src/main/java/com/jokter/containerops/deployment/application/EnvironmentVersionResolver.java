package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

final class EnvironmentVersionResolver {
    private final ObjectMapper objectMapper;
    private final ObjectMapper yamlMapper;

    EnvironmentVersionResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.yamlMapper = new ObjectMapper(new YAMLFactory());
    }

    Map<String, String> packageVersions(String text, String architecture) {
        JsonNode packages = json(text, "lock.json").path("packages");
        if (!packages.isArray()) throw new IllegalStateException("lock.json 缺少 packages 数组");
        Map<String, String> versions = new LinkedHashMap<>();
        for (JsonNode item : packages) {
            String name = required(item, "name", "lock.json packages.name");
            String version = required(item, "version", "lock.json packages.version");
            String arch = required(item, "arch", "lock.json packages.arch");
            if (!arch.equals(architecture)) continue;
            String existing = versions.putIfAbsent(name, version);
            if (existing != null && !existing.equals(version)) {
                throw new IllegalStateException("lock.json 中 " + name + "/" + architecture
                        + " 存在多个版本：" + existing + "、" + version);
            }
        }
        if (versions.isEmpty()) throw new IllegalStateException("lock.json 中不存在架构 " + architecture + " 的包版本");
        return versions;
    }

    HelmEnvironmentValues helmEnvironment(String text) {
        JsonNode global = json(text, "Helm values").path("global");
        if (!global.isObject()) throw new IllegalStateException("Helm values 缺少 global 配置");
        Map<String, String> placeholders = new LinkedHashMap<>();
        JsonNode images = global.path("image");
        if (images.isObject()) {
            images.fields().forEachRemaining(entry -> {
                JsonNode image = entry.getValue();
                if (!image.path("name").isTextual() || !image.path("version").isValueNode()) return;
                putUnique(placeholders, image.path("name").asText(), image.path("version").asText(), "Helm image");
            });
        }
        JsonNode cloudsop = global.path("cloudsop");
        if (cloudsop.isObject()) {
            cloudsop.fields().forEachRemaining(entry -> {
                Set<String> versions = new LinkedHashSet<>(entry.getValue().findValuesAsText("engineVersion"));
                versions.removeIf(String::isBlank);
                if (versions.size() > 1) {
                    throw new IllegalStateException("Helm cloudsop." + entry.getKey() + " 存在多个引擎版本："
                            + String.join("、", versions));
                }
                versions.stream().findFirst().ifPresent(version ->
                        putUnique(placeholders, entry.getKey(), version, "Helm cloudsop"));
            });
        }
        Map<String, String> overrides = new LinkedHashMap<>();
        copy(global, "nodePool", overrides, "nodePool");
        copy(global, "domains", overrides, "domains");
        copy(global.path("repo"), "address", overrides, "repo.address");
        return new HelmEnvironmentValues(Map.copyOf(placeholders), Map.copyOf(overrides));
    }

    Optional<String> releaseFor(String module, List<String> releases) {
        List<String> candidates = new ArrayList<>();
        candidates.add(module + "chart");
        candidates.add(module.replace("-", "") + "chart");
        return candidates.stream().filter(releases::contains).findFirst();
    }

    List<RuntimeContainer> runtimeContainers(String text) {
        List<RuntimeContainer> containers = new ArrayList<>();
        for (String line : text.lines().filter(value -> !value.isBlank()).toList()) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 5) throw new IllegalStateException("Pod 精简列表格式不正确：" + line);
            if (!columns[3].equals("true") && !columns[3].equals("false")) {
                throw new IllegalStateException("Pod Ready 状态格式不正确：" + line);
            }
            containers.add(new RuntimeContainer(columns[0], columns[1], columns[2], Boolean.parseBoolean(columns[3]), columns[4]));
        }
        return List.copyOf(containers);
    }

    List<String> availableServices(List<String> buildServices, List<RuntimeContainer> containers) {
        Set<String> pods = new LinkedHashSet<>();
        containers.forEach(container -> pods.add(container.pod()));
        return buildServices.stream()
                .filter(service -> pods.stream().anyMatch(pod -> pod.startsWith(service + "-")))
                .toList();
    }

    ServiceRuntimeIdentity runtimeIdentity(String values) {
        JsonNode root;
        try {
            root = yamlMapper.readTree(values);
        } catch (Exception exception) {
            throw new IllegalStateException("服务 values.yaml 不是有效 YAML", exception);
        }
        if (root == null || !root.isObject()) throw new IllegalStateException("服务 values.yaml 缺少根配置");
        String workload = required(root.path("appg"), "name", "values.yaml appg.name");
        Set<String> processNames = new LinkedHashSet<>(root.findValuesAsText("processName"));
        processNames.removeIf(String::isBlank);
        if (processNames.size() != 1) {
            throw new IllegalStateException("values.yaml processName 必须唯一，实际为：" + String.join("、", processNames));
        }
        return new ServiceRuntimeIdentity(workload, processNames.iterator().next());
    }

    RuntimeContainer targetFor(ServiceRuntimeIdentity identity, List<RuntimeContainer> containers) {
        List<RuntimeContainer> candidates = containers.stream()
                .filter(container -> container.pod().startsWith(identity.workload() + "-"))
                .filter(container -> container.container().equals(identity.container()))
                .filter(container -> container.phase().equals("Running") && container.ready())
                .sorted(Comparator.comparing(RuntimeContainer::pod))
                .toList();
        if (candidates.isEmpty()) {
            throw new IllegalStateException("工作负载 " + identity.workload() + " 没有 Running/Ready 的容器 " + identity.container());
        }
        if (candidates.stream().anyMatch(candidate -> candidate.image().isBlank())) {
            throw new IllegalStateException("工作负载 " + identity.workload() + " 的 Ready 副本缺少镜像标识");
        }
        Set<String> images = new LinkedHashSet<>();
        candidates.forEach(candidate -> images.add(candidate.image()));
        if (images.size() > 1) {
            String details = candidates.stream()
                    .map(candidate -> candidate.pod() + "=" + candidate.image())
                    .reduce((left, right) -> left + "、" + right)
                    .orElse("");
            throw new IllegalStateException("工作负载 " + identity.workload() + " 的 Ready 副本镜像不一致：" + details);
        }
        return candidates.get(0);
    }

    String architecture(String value) {
        return switch (value.trim()) {
            case "amd64" -> "x86_64";
            case "arm64" -> "aarch64";
            default -> value.trim();
        };
    }

    private JsonNode json(String text, String source) {
        try {
            return objectMapper.readTree(text);
        } catch (Exception exception) {
            throw new IllegalStateException(source + " 不是有效 JSON", exception);
        }
    }

    private String required(JsonNode node, String field, String path) {
        JsonNode value = node.path(field);
        if (!value.isTextual() || value.asText().isBlank()) throw new IllegalStateException(path + " 不能为空");
        return value.asText();
    }

    private void putUnique(Map<String, String> values, String name, String version, String source) {
        if (name.isBlank() || version.isBlank()) return;
        String existing = values.putIfAbsent(name, version);
        if (existing != null && !existing.equals(version)) {
            throw new IllegalStateException(source + " 中 " + name + " 存在多个版本：" + existing + "、" + version);
        }
    }

    private void copy(JsonNode parent, String field, Map<String, String> result, String key) {
        JsonNode value = parent.path(field);
        if (!value.isMissingNode()) result.put(key, value.isContainerNode() ? value.toString() : value.asText());
    }
}
