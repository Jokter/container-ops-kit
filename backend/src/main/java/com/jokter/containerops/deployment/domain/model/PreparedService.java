package com.jokter.containerops.deployment.domain.model;

import java.util.List;
import java.util.Map;
import java.util.Set;

public final class PreparedService {
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
        this.unresolvedImages = Set.copyOf(unresolvedImages);
        this.errors = List.copyOf(errors);
        this.stage = errors.isEmpty() ? DeploymentStage.ANALYZED : DeploymentStage.FAILED;
    }

    public static PreparedService success(String service, String values, String chart) {
        return new PreparedService(service, values, chart, Map.of(), List.of(), Set.of(), List.of());
    }

    public void updateValues(String values) {
        this.values = values;
        stage = DeploymentStage.ANALYZED;
        stageError = null;
    }

    public void generated() {
        require(DeploymentStage.ANALYZED);
        stage = DeploymentStage.GENERATED;
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
    public Set<String> unresolvedImages() { return unresolvedImages; }
    public List<String> errors() { return errors; }
    public DeploymentStage stage() { return stage; }
    public String stageError() { return stageError; }
}
