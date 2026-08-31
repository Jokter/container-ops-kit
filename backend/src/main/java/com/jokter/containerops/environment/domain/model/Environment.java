package com.jokter.containerops.environment.domain.model;

import java.time.Instant;
import java.util.Objects;

public class Environment {
    private Long id;
    private ReleaseVersion releaseVersion;
    private EnvironmentType type;
    private String name;
    private String host;
    private Integer sshPort;
    private String password;
    private String rootPassword;
    private String workDirectory;
    private String architecture;
    private String businessPlaneUrl;
    private String businessPlaneUser;
    private String businessPlanePassword;
    private String managementPlaneUrl;
    private String managementPlaneUser;
    private String managementPlanePassword;
    private ConnectionStatus connectionStatus;
    private Instant lastTestedAt;
    private Long lastTestLatencyMs;
    private String lastTestError;
    private Instant createdAt;
    private Instant updatedAt;
    private Long version;

    private Environment() {
    }

    public static Environment create(
            ReleaseVersion releaseVersion,
            EnvironmentType type,
            String name,
            String host,
            Integer sshPort,
            String password,
            String rootPassword,
            String workDirectory,
            String architecture,
            String businessPlaneUrl,
            String businessPlaneUser,
            String businessPlanePassword,
            String managementPlaneUrl,
            String managementPlaneUser,
            String managementPlanePassword
    ) {
        Environment environment = new Environment();
        environment.releaseVersion = releaseVersion;
        environment.type = type;
        environment.name = name;
        environment.host = host;
        environment.sshPort = sshPort;
        environment.password = password;
        environment.rootPassword = type == EnvironmentType.CONTAINER ? rootPassword : null;
        environment.workDirectory = workDirectory;
        environment.architecture = architecture;
        environment.businessPlaneUrl = businessPlaneUrl;
        environment.businessPlaneUser = businessPlaneUser;
        environment.businessPlanePassword = businessPlanePassword;
        environment.managementPlaneUrl = managementPlaneUrl;
        environment.managementPlaneUser = managementPlaneUser;
        environment.managementPlanePassword = managementPlanePassword;
        environment.connectionStatus = ConnectionStatus.UNTESTED;
        environment.createdAt = Instant.now();
        environment.updatedAt = environment.createdAt;
        return environment;
    }

    public static Environment restore(
            Long id,
            ReleaseVersion releaseVersion,
            EnvironmentType type,
            String name,
            String host,
            Integer sshPort,
            String password,
            String rootPassword,
            String workDirectory,
            String architecture,
            String businessPlaneUrl,
            String businessPlaneUser,
            String businessPlanePassword,
            String managementPlaneUrl,
            String managementPlaneUser,
            String managementPlanePassword,
            ConnectionStatus status,
            Instant testedAt,
            Long latency,
            String error,
            Instant createdAt,
            Instant updatedAt,
            Long version
    ) {
        Environment environment = create(
                releaseVersion,
                type,
                name,
                host,
                sshPort,
                password,
                rootPassword,
                workDirectory,
                architecture,
                businessPlaneUrl,
                businessPlaneUser,
                businessPlanePassword,
                managementPlaneUrl,
                managementPlaneUser,
                managementPlanePassword
        );
        environment.id = id;
        environment.connectionStatus = status;
        environment.lastTestedAt = testedAt;
        environment.lastTestLatencyMs = latency;
        environment.lastTestError = error;
        environment.createdAt = createdAt;
        environment.updatedAt = updatedAt;
        environment.version = version;
        return environment;
    }

    public void update(
            ReleaseVersion releaseVersion,
            EnvironmentType type,
            String name,
            String host,
            Integer sshPort,
            String password,
            String rootPassword,
            String workDirectory,
            String architecture,
            String businessPlaneUrl,
            String businessPlaneUser,
            String businessPlanePassword,
            String managementPlaneUrl,
            String managementPlaneUser,
            String managementPlanePassword
    ) {
        boolean connectionChanged = !Objects.equals(this.host, host)
                || !Objects.equals(this.sshPort, sshPort)
                || !Objects.equals(this.password, password)
                || !Objects.equals(this.rootPassword, rootPassword);
        this.releaseVersion = releaseVersion;
        this.type = type;
        this.name = name;
        this.host = host;
        this.sshPort = sshPort;
        this.password = password;
        this.rootPassword = type == EnvironmentType.CONTAINER ? rootPassword : null;
        this.workDirectory = workDirectory;
        this.architecture = architecture;
        this.businessPlaneUrl = businessPlaneUrl;
        this.businessPlaneUser = businessPlaneUser;
        this.businessPlanePassword = businessPlanePassword;
        this.managementPlaneUrl = managementPlaneUrl;
        this.managementPlaneUser = managementPlaneUser;
        this.managementPlanePassword = managementPlanePassword;
        this.updatedAt = Instant.now();
        if (connectionChanged) {
            connectionStatus = ConnectionStatus.UNTESTED;
            lastTestedAt = null;
            lastTestLatencyMs = null;
            lastTestError = null;
        }
    }

    public SshUser defaultSshUser() {
        return type == EnvironmentType.BUILD ? SshUser.HUAWEI : SshUser.SOPUSER;
    }

    public String sshPassword(SshUser user) {
        if (!user.supports(type)) {
            throw new IllegalArgumentException("SSH 用户与环境类型不匹配");
        }
        String selectedPassword = user == SshUser.ROOT ? rootPassword : password;
        if (selectedPassword == null || selectedPassword.isBlank()) {
            throw new IllegalArgumentException(user.username() + " 密码未配置");
        }
        return selectedPassword;
    }

    public void markTest(ConnectionStatus status, long latency, String error) {
        connectionStatus = status;
        lastTestedAt = Instant.now();
        lastTestLatencyMs = latency;
        lastTestError = error;
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public ReleaseVersion getReleaseVersion() { return releaseVersion; }
    public EnvironmentType getType() { return type; }
    public String getName() { return name; }
    public String getHost() { return host; }
    public Integer getSshPort() { return sshPort; }
    public String getPassword() { return password; }
    public String getRootPassword() { return rootPassword; }
    public String getWorkDirectory() { return workDirectory; }
    public String getArchitecture() { return architecture; }
    public String getBusinessPlaneUrl() { return businessPlaneUrl; }
    public String getBusinessPlaneUser() { return businessPlaneUser; }
    public String getBusinessPlanePassword() { return businessPlanePassword; }
    public String getManagementPlaneUrl() { return managementPlaneUrl; }
    public String getManagementPlaneUser() { return managementPlaneUser; }
    public String getManagementPlanePassword() { return managementPlanePassword; }
    public ConnectionStatus getConnectionStatus() { return connectionStatus; }
    public Instant getLastTestedAt() { return lastTestedAt; }
    public Long getLastTestLatencyMs() { return lastTestLatencyMs; }
    public String getLastTestError() { return lastTestError; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Long getVersion() { return version; }
}
