package com.jokter.containerops.deployment.domain.model;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PreparedService {
    private static final Pattern IMAGE_VERSION = Pattern.compile("\\{version:([A-Za-z0-9_.-]+)}");
    private static final Pattern UNRESOLVED_VALUE = Pattern.compile("\\{[A-Za-z0-9_:.-]+}|replaceByOssDiy");
    private final String service;
    private String values;
    private final String chart;
    private final Map<String, String> templates;
    private final List<ReplaceItem> replaceItems;
    private final Set<String> unresolvedImages;
    private final List<String> errors;
    private DeploymentStage stage;
    private String stageError;

    public PreparedService(
            String service,
            String values,
            String chart,
            Map<String, String> templates,
            List<ReplaceItem> replaceItems,
            Set<String> unresolvedImages,
            List<String> errors
    ) {
        this.service = service;
        this.values = values;
        this.chart = chart;
        this.templates = Map.copyOf(templates);
        this.replaceItems = List.copyOf(replaceItems);
        this.unresolvedImages = new LinkedHashSet<>(unresolvedImages);
        this.errors = List.copyOf(errors);
        this.stage = errors.isEmpty() ? DeploymentStage.ANALYZED : DeploymentStage.FAILED;
    }

    public static PreparedService success(String service, String values, String chart) {
        return new PreparedService(service, values, chart, Map.of(), List.of(), Set.of(), List.of());
    }

    public void updateValues(String values) {
        this.values = values;
        unresolvedImages.clear();
        Matcher matcher = IMAGE_VERSION.matcher(values);
        while (matcher.find()) {
            unresolvedImages.add(matcher.group(1));
        }
        stage = DeploymentStage.ANALYZED;
        stageError = null;
    }

    public boolean hasUnresolvedValues() {
        return UNRESOLVED_VALUE.matcher(values).find();
    }

    public void generated() {
        require(DeploymentStage.ANALYZED);
        stage = DeploymentStage.GENERATED;
    }

    public void generationFailed(String error) {
        require(DeploymentStage.ANALYZED);
        stage = DeploymentStage.FAILED;
        stageError = error;
    }

    public void rendered(boolean successful, String error) {
        require(DeploymentStage.GENERATED);
        stage = successful ? DeploymentStage.RENDERED : DeploymentStage.FAILED;
        stageError = error;
    }

    public void deploying() {
        require(DeploymentStage.RENDERED);
        stage = DeploymentStage.DEPLOYING;
    }

    public void deployed(boolean successful, String error) {
        require(DeploymentStage.DEPLOYING);
        stage = successful ? DeploymentStage.SUCCEEDED : DeploymentStage.FAILED;
        stageError = error;
    }

    private void require(DeploymentStage expected) {
        if (stage != expected) {
            throw new IllegalStateException("部署阶段顺序不正确");
        }
    }

    public String service() { return service; }
    public String values() { return values; }
    public String chart() { return chart; }
    public Map<String, String> templates() { return templates; }
    public List<ReplaceItem> replaceItems() { return replaceItems; }
    public Set<String> unresolvedImages() { return Set.copyOf(unresolvedImages); }
    public List<String> errors() { return errors; }
    public DeploymentStage stage() { return stage; }
    public String stageError() { return stageError; }
}
