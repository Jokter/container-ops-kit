package com.jokter.containerops.deployment.domain.model;

import java.util.LinkedHashMap;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

public final class DeploymentPreparation {
    private static final Pattern SERVICE_NAME = Pattern.compile("[a-z0-9](?:[-a-z0-9]{0,51}[a-z0-9])?");
    private static final Pattern NAMESPACE = Pattern.compile("[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?");
    private final String id;
    private final Long artifactId;
    private final Long environmentId;
    private final String module;
    private final String namespace;
    private final Map<String, PreparedService> services = new LinkedHashMap<>();
    private long revision = 1L;
    private String confirmationToken;
    private long confirmedRevision;

    private DeploymentPreparation(String id, Long artifactId, Long environmentId, String module, String namespace, List<String> serviceNames) {
        this.id = id;
        this.artifactId = artifactId;
        this.environmentId = environmentId;
        this.module = module;
        this.namespace = namespace;
        for (String service : serviceNames) {
            if (!SERVICE_NAME.matcher(service).matches()) {
                throw new IllegalArgumentException("服务名称格式不正确");
            }
            services.put(service, null);
        }
    }

    public static DeploymentPreparation create(String id, Long artifactId, Long environmentId, String module, String namespace, List<String> services) {
        if (services == null || services.isEmpty() || namespace == null || !NAMESPACE.matcher(namespace).matches()) {
            throw new IllegalArgumentException("部署服务和命名空间不能为空");
        }
        return new DeploymentPreparation(id, artifactId, environmentId, module, namespace, services);
    }

    public synchronized void analyzed(String service, PreparedService prepared) {
        requireService(service);
        services.put(service, prepared);
        confirmationToken = null;
    }

    public synchronized void updateValues(String service, String values) {
        service(service).updateValues(values);
        revision++;
        confirmationToken = null;
    }

    public synchronized void generated(String service) {
        service(service).generated();
        confirmationToken = null;
    }

    public synchronized void rendered(String service, boolean successful, String error) {
        service(service).rendered(successful, error);
        confirmationToken = null;
    }

    public synchronized String issueConfirmation() {
        if (services.values().stream().anyMatch(item -> item == null || item.stage() != DeploymentStage.RENDERED)) {
            throw new IllegalStateException("所有服务必须通过最新渲染校验");
        }
        confirmationToken = UUID.randomUUID().toString();
        confirmedRevision = revision;
        return confirmationToken;
    }

    public synchronized void authorizeDeployment(long requestedRevision, String token) {
        if (requestedRevision != revision || confirmedRevision != revision || confirmationToken == null || !confirmationToken.equals(token)) {
            throw new IllegalStateException("部署确认已失效，请重新确认");
        }
        if (services.values().stream().anyMatch(item -> item.stage() != DeploymentStage.RENDERED)) {
            throw new IllegalStateException("所有服务必须通过最新渲染校验");
        }
        confirmationToken = null;
    }

    public synchronized void deploying(String service) { service(service).deploying(); }
    public synchronized void deployed(String service, boolean successful, String error) { service(service).deployed(successful, error); }

    public synchronized PreparedService service(String service) {
        requireService(service);
        PreparedService prepared = services.get(service);
        if (prepared == null) {
            throw new IllegalStateException("服务尚未完成分析");
        }
        return prepared;
    }

    private void requireService(String service) {
        if (!services.containsKey(service)) {
            throw new IllegalArgumentException("服务不在当前部署准备中");
        }
    }

    public String id() { return id; }
    public Long artifactId() { return artifactId; }
    public Long environmentId() { return environmentId; }
    public String module() { return module; }
    public String namespace() { return namespace; }
    public synchronized long revision() { return revision; }
    public synchronized Map<String, PreparedService> services() { return Collections.unmodifiableMap(new LinkedHashMap<>(services)); }
}
