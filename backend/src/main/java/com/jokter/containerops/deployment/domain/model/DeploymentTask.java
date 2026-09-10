package com.jokter.containerops.deployment.domain.model;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

public final class DeploymentTask {
    private static final Pattern SERVICE_NAME = Pattern.compile("[a-z0-9](?:[-a-z0-9]{0,51}[a-z0-9])?");
    private static final Pattern NAMESPACE = Pattern.compile("[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?");
    private final String id;
    private final DeploymentMode mode;
    private final Long artifactId;
    private final Long environmentId;
    private final String module;
    private final String namespace;
    private final Map<String, PreparedService> services = new LinkedHashMap<>();
    private final Instant createdAt = Instant.now();
    private long revision = 1L;
    private DeploymentTaskStatus status = DeploymentTaskStatus.PENDING;
    private Instant startedAt;
    private Instant finishedAt;

    private DeploymentTask(String id, DeploymentMode mode, Long artifactId, Long environmentId, String module, String namespace, List<String> serviceNames) {
        this.id = id;
        this.mode = mode;
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

    public static DeploymentTask create(String id, DeploymentMode mode, Long artifactId, Long environmentId, String module, String namespace, List<String> services) {
        if (mode == null || services == null || services.isEmpty() || namespace == null || !NAMESPACE.matcher(namespace).matches()) {
            throw new IllegalArgumentException("部署服务和命名空间不能为空");
        }
        return new DeploymentTask(id, mode, artifactId, environmentId, module, namespace, services);
    }

    public synchronized void beginAnalysis() {
        if (status != DeploymentTaskStatus.PENDING) {
            throw new IllegalStateException("部署任务已经开始分析");
        }
        status = DeploymentTaskStatus.ANALYZING;
    }

    public synchronized void analyzed(String service, PreparedService prepared) {
        if (status != DeploymentTaskStatus.ANALYZING) {
            throw new IllegalStateException("部署任务尚未开始分析");
        }
        requireService(service);
        services.put(service, prepared);
        if (services.values().stream().allMatch(item -> item != null)) {
            boolean failed = services.values().stream().anyMatch(item -> !item.errors().isEmpty());
            if (failed || mode == DeploymentMode.QUICK && services.values().stream().anyMatch(PreparedService::hasUnresolvedValues)) {
                status = DeploymentTaskStatus.FAILED;
                finishedAt = Instant.now();
            } else if (mode == DeploymentMode.REVIEW) {
                status = DeploymentTaskStatus.AWAITING_REVIEW;
            }
        }
    }

    public synchronized void updateValues(String service, String values) {
        if (mode != DeploymentMode.REVIEW || status != DeploymentTaskStatus.AWAITING_REVIEW) {
            throw new IllegalStateException("当前部署任务不能修改 values");
        }
        service(service).updateValues(values);
        revision++;
    }

    public synchronized void generated(String service) {
        service(service).generated();
    }

    public synchronized void generationFailed(String service, String error) {
        service(service).generationFailed(error);
    }

    public synchronized void rendered(String service, boolean successful, String error) {
        service(service).rendered(successful, error);
    }

    public synchronized void beginAutomaticExecution() {
        if (mode != DeploymentMode.QUICK) {
            throw new IllegalStateException("审阅部署必须由研发确认后执行");
        }
        beginExecution(revision);
    }

    public synchronized boolean beginReviewedExecution(long expectedRevision) {
        if (mode != DeploymentMode.REVIEW) {
            throw new IllegalStateException("快速部署不能人工执行");
        }
        if (startedAt != null && expectedRevision == revision) return false;
        beginExecution(expectedRevision);
        return true;
    }

    private void beginExecution(long expectedRevision) {
        if (status != (mode == DeploymentMode.REVIEW ? DeploymentTaskStatus.AWAITING_REVIEW : DeploymentTaskStatus.ANALYZING)) {
            throw new IllegalStateException("部署任务已经开始执行");
        }
        if (expectedRevision != revision || services.values().stream().anyMatch(item -> item == null
                || item.stage() != DeploymentStage.ANALYZED || !item.errors().isEmpty() || item.hasUnresolvedValues())) {
            throw new IllegalStateException("部署配置已变化或尚未完成分析");
        }
        status = DeploymentTaskStatus.PREPARING;
        startedAt = Instant.now();
    }

    public synchronized void deploying(String service) { service(service).deploying(); }
    public synchronized void deployed(String service, boolean successful, String error) { service(service).deployed(successful, error); }
    public synchronized void beginDeployment() {
        if (status != DeploymentTaskStatus.PREPARING) {
            throw new IllegalStateException("部署任务阶段不正确");
        }
        status = DeploymentTaskStatus.DEPLOYING;
    }
    public synchronized void finishExecution() {
        if (status != DeploymentTaskStatus.PREPARING && status != DeploymentTaskStatus.DEPLOYING) {
            throw new IllegalStateException("部署任务阶段不正确");
        }
        status = services.values().stream().allMatch(item -> item != null && item.stage() == DeploymentStage.SUCCEEDED)
                ? DeploymentTaskStatus.SUCCEEDED : DeploymentTaskStatus.FAILED;
        finishedAt = Instant.now();
    }

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
            throw new IllegalArgumentException("服务不在当前部署任务中");
        }
    }

    public String id() { return id; }
    public DeploymentMode mode() { return mode; }
    public Long artifactId() { return artifactId; }
    public Long environmentId() { return environmentId; }
    public String module() { return module; }
    public String namespace() { return namespace; }
    public Instant createdAt() { return createdAt; }
    public synchronized Instant startedAt() { return startedAt; }
    public synchronized Instant finishedAt() { return finishedAt; }
    public synchronized long revision() { return revision; }
    public synchronized DeploymentTaskStatus status() { return status; }
    public synchronized Map<String, PreparedService> services() { return Collections.unmodifiableMap(new LinkedHashMap<>(services)); }
}
