package com.jokter.containerops.deployment.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

final class EnvironmentVersionResolver {
    private final ObjectMapper objectMapper;

    EnvironmentVersionResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
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

    Map<String, String> imageVersions(String text) {
        JsonNode images = json(text, "crictl images").path("images");
        if (!images.isArray()) throw new IllegalStateException("crictl images 输出缺少 images 数组");
        Map<String, Set<String>> candidates = new LinkedHashMap<>();
        for (JsonNode image : images) {
            for (JsonNode tagNode : image.path("repoTags")) {
                String tag = tagNode.asText();
                int separator = tag.lastIndexOf(':');
                int slash = tag.lastIndexOf('/');
                if (separator <= slash) continue;
                String name = tag.substring(slash + 1, separator)
                        .replaceFirst("-(x86_64|aarch64|x86|aarch)$", "");
                candidates.computeIfAbsent(name, ignored -> new LinkedHashSet<>()).add(tag.substring(separator + 1));
            }
        }
        Map<String, String> versions = new LinkedHashMap<>();
        candidates.forEach((name, tags) -> {
            if (tags.size() == 1) versions.put(name, tags.iterator().next());
        });
        return versions;
    }

    Optional<String> releaseFor(String module, List<String> releases) {
        List<String> candidates = new ArrayList<>();
        candidates.add(module + "chart");
        candidates.add(module.replace("-", "") + "chart");
        return candidates.stream().filter(releases::contains).findFirst();
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
