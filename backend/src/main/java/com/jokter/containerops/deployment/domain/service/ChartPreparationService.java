package com.jokter.containerops.deployment.domain.service;

import com.jokter.containerops.deployment.domain.model.ReplaceItem;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ChartPreparationService {
    private static final Pattern VERSION_LINE = Pattern.compile("(?m)^(\\s*)([A-Za-z0-9_.-]+)(\\s*:\\s*)\\{version}(\\s*)$");
    private static final Pattern IMAGE_VERSION = Pattern.compile("\\{version:([A-Za-z0-9_.-]+)}");
    private static final Pattern REMAINING = Pattern.compile("\\{[A-Za-z0-9_:.-]+}|replaceByBuild|replaceByOssDiy");
    private static final Pattern YAML_LINE = Pattern.compile("^(\\s*)([A-Za-z0-9_.-]+)(\\s*:\\s*)([^#]*)(.*)$");

    public PreparedChart prepare(String service, ChartSource source, EnvironmentSnapshot environment) {
        List<ReplaceItem> replacements = new ArrayList<>();
        Set<String> unresolvedImages = new LinkedHashSet<>();
        boolean containsVersionPlaceholder = source.values().contains("{version");
        String values = replaceComponentVersions(source.values(), environment.versions(), replacements);
        values = replaceJar(values, service, environment.jars(), replacements);
        values = replaceImageVersions(values, environment.imageTags(), unresolvedImages, replacements);
        String pureVersion = selectVersion(service, environment.versions());
        if (pureVersion != null) {
            values = replacePureVersions(values, pureVersion, replacements);
        }
        String global = applyGlobalOverrides(source.globalBlock(), environment.globalOverrides(), replacements);
        values = joinGlobal(global, values);
        String chartVersion = selectVersion(service, environment.versions());
        String chart = chartVersion == null ? source.chart() : source.chart().replace("{version}", chartVersion);
        List<String> errors = new ArrayList<>();
        if (!containsVersionPlaceholder) {
            errors.add("values.yaml 不包含版本占位符");
        }
        Matcher remaining = REMAINING.matcher(values + "\n" + chart);
        while (remaining.find()) {
            String value = remaining.group();
            if (!errors.contains(value)) {
                errors.add("存在未解析占位符：" + value);
            }
        }
        return new PreparedChart(values, chart, source.templates(), replacements, unresolvedImages, errors);
    }

    private String replaceComponentVersions(String values, Map<String, String> versions, List<ReplaceItem> replacements) {
        Matcher matcher = VERSION_LINE.matcher(values);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(2);
            String version = versions.get(key);
            if (version == null) {
                matcher.appendReplacement(result, Matcher.quoteReplacement(matcher.group()));
            } else {
                replacements.add(new ReplaceItem("values.yaml", "pkgVersion." + key, "{version}", version));
                matcher.appendReplacement(result, Matcher.quoteReplacement(matcher.group(1) + key + matcher.group(3) + version + matcher.group(4)));
            }
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String replaceJar(String values, String service, String jars, List<ReplaceItem> replacements) {
        String replacement = jars == null || jars.isBlank() ? "null" : "'" + jars.replace("'", "''") + "'";
        Pattern pattern = Pattern.compile("(?m)^(\\s*" + Pattern.quote(service) + "\\s*:\\s*)['\"]?replaceByBuild['\"]?(\\s*)$");
        Matcher matcher = pattern.matcher(values);
        if (matcher.find()) {
            replacements.add(new ReplaceItem("values.yaml", "jars." + service, "replaceByBuild", replacement));
            return matcher.replaceAll(Matcher.quoteReplacement(matcher.group(1) + replacement + matcher.group(2)));
        }
        return values.replace("replaceByBuild", replacement);
    }

    private String replaceImageVersions(String values, Map<String, String> imageTags, Set<String> unresolved, List<ReplaceItem> replacements) {
        Matcher matcher = IMAGE_VERSION.matcher(values);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String image = matcher.group(1);
            String version = imageTags.get(image);
            if (version == null) {
                unresolved.add(image);
                matcher.appendReplacement(result, Matcher.quoteReplacement(matcher.group()));
            } else {
                replacements.add(new ReplaceItem("values.yaml", "image." + image, matcher.group(), version));
                matcher.appendReplacement(result, Matcher.quoteReplacement(version));
            }
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String replacePureVersions(String values, String version, List<ReplaceItem> replacements) {
        if (values.contains("{version}")) {
            replacements.add(new ReplaceItem("values.yaml", "global.version", "{version}", version));
        }
        return values.replace("{version}", version);
    }

    private String applyGlobalOverrides(String global, Map<String, String> overrides, List<ReplaceItem> replacements) {
        String result = global == null ? "" : global;
        for (Map.Entry<String, String> entry : overrides.entrySet()) {
            result = replaceYamlPath(result, "global." + entry.getKey(), entry.getValue(), replacements);
        }
        return result;
    }

    private String replaceYamlPath(String yaml, String targetPath, String value, List<ReplaceItem> replacements) {
        List<String> lines = new ArrayList<>(List.of(yaml.split("\\n", -1)));
        List<String> parents = new ArrayList<>();
        List<Integer> indents = new ArrayList<>();
        for (int index = 0; index < lines.size(); index++) {
            Matcher matcher = YAML_LINE.matcher(lines.get(index));
            if (!matcher.matches()) continue;
            int indent = matcher.group(1).length();
            while (!indents.isEmpty() && indents.get(indents.size() - 1) >= indent) {
                indents.remove(indents.size() - 1);
                parents.remove(parents.size() - 1);
            }
            String key = matcher.group(2);
            String path = String.join(".", parents) + (parents.isEmpty() ? "" : ".") + key;
            if (path.equals(targetPath)) {
                String oldValue = matcher.group(4).trim();
                lines.set(index, matcher.group(1) + key + matcher.group(3) + yamlScalar(value) + matcher.group(5));
                if (value.startsWith("{") || value.startsWith("[")) {
                    while (index + 1 < lines.size() && indentation(lines.get(index + 1)) > indent) lines.remove(index + 1);
                }
                replacements.add(new ReplaceItem("values.yaml", targetPath, oldValue, value));
                return String.join("\n", lines);
            }
            parents.add(key);
            indents.add(indent);
        }
        return yaml;
    }

    private int indentation(String line) {
        int count = 0;
        while (count < line.length() && line.charAt(count) == ' ') count++;
        return line.isBlank() ? Integer.MAX_VALUE : count;
    }

    private String joinGlobal(String global, String values) {
        if (global == null || global.isBlank()) {
            return values;
        }
        String withoutGlobal = values.replaceFirst("(?sm)^global:\\s*.*?(?=^[A-Za-z0-9_.-]+:|\\z)", "");
        return global.stripTrailing() + "\n" + withoutGlobal.stripLeading();
    }

    private String selectVersion(String service, Map<String, String> versions) {
        if (versions.containsKey(service)) {
            return versions.get(service);
        }
        if (versions.containsKey("cbb_engr")) {
            return versions.get("cbb_engr");
        }
        return versions.values().stream().findFirst().orElse(null);
    }

    private String yamlScalar(String value) {
        if (value.matches("-?[0-9]+(?:\\.[0-9]+)?|true|false|null") || value.startsWith("{") || value.startsWith("[")) {
            return value;
        }
        return "'" + value.replace("'", "''") + "'";
    }
}
