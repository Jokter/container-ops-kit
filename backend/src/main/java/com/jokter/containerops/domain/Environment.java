package com.jokter.containerops.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "environment")
public class Environment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "release_version_id") private ReleaseVersion releaseVersion;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private EnvironmentType type;
    @Column(nullable = false) private String name;
    @Column(nullable = false) private String host;
    @Column(name = "ssh_port", nullable = false) private Integer sshPort;
    @Column(nullable = false) private String password;
    @Column(name = "work_directory") private String workDirectory;
    private String architecture;
    private String mae;
    @Column(name = "mae_user") private String maeUser;
    @Column(name = "mae_password") private String maePassword;
    private String osmu;
    @Column(name = "osmu_user") private String osmuUser;
    @Column(name = "osmu_password") private String osmuPassword;
    @Enumerated(EnumType.STRING) @Column(name = "connection_status", nullable = false) private ConnectionStatus connectionStatus;
    @Column(name = "last_tested_at") private Instant lastTestedAt;
    @Column(name = "last_test_latency_ms") private Long lastTestLatencyMs;
    @Column(name = "last_test_error") private String lastTestError;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version @Column(nullable = false) private Long version;

    protected Environment() {}

    public static Environment create(ReleaseVersion releaseVersion, EnvironmentType type, String name, String host, Integer sshPort, String password, String workDirectory, String architecture, String mae, String maeUser, String maePassword, String osmu, String osmuUser, String osmuPassword) {
        Environment environment = new Environment();
        environment.releaseVersion = releaseVersion;
        environment.type = type;
        environment.name = name;
        environment.host = host;
        environment.sshPort = sshPort;
        environment.password = password;
        environment.workDirectory = workDirectory;
        environment.architecture = architecture;
        environment.mae = mae;
        environment.maeUser = maeUser;
        environment.maePassword = maePassword;
        environment.osmu = osmu;
        environment.osmuUser = osmuUser;
        environment.osmuPassword = osmuPassword;
        environment.connectionStatus = ConnectionStatus.UNTESTED;
        environment.createdAt = Instant.now();
        environment.updatedAt = environment.createdAt;
        return environment;
    }

    public void update(ReleaseVersion releaseVersion, EnvironmentType type, String name, String host, Integer sshPort, String password, String workDirectory, String architecture, String mae, String maeUser, String maePassword, String osmu, String osmuUser, String osmuPassword) {
        boolean connectionChanged = !this.host.equals(host) || !this.sshPort.equals(sshPort) || !this.password.equals(password);
        this.releaseVersion = releaseVersion;
        this.type = type;
        this.name = name;
        this.host = host;
        this.sshPort = sshPort;
        this.password = password;
        this.workDirectory = workDirectory;
        this.architecture = architecture;
        this.mae = mae;
        this.maeUser = maeUser;
        this.maePassword = maePassword;
        this.osmu = osmu;
        this.osmuUser = osmuUser;
        this.osmuPassword = osmuPassword;
        this.updatedAt = Instant.now();
        if (connectionChanged) {
            connectionStatus = ConnectionStatus.UNTESTED;
            lastTestedAt = null;
            lastTestLatencyMs = null;
            lastTestError = null;
        }
    }

    public void markTest(ConnectionStatus status, long latency, String error) {
        connectionStatus = status;
        lastTestedAt = Instant.now();
        lastTestLatencyMs = latency;
        lastTestError = error;
        updatedAt = Instant.now();
    }

    public Long getId(){return id;} public ReleaseVersion getReleaseVersion(){return releaseVersion;} public EnvironmentType getType(){return type;}
    public String getName(){return name;} public String getHost(){return host;} public Integer getSshPort(){return sshPort;} public String getPassword(){return password;}
    public String getWorkDirectory(){return workDirectory;} public String getArchitecture(){return architecture;} public String getMae(){return mae;} public String getMaeUser(){return maeUser;} public String getMaePassword(){return maePassword;} public String getOsmu(){return osmu;} public String getOsmuUser(){return osmuUser;} public String getOsmuPassword(){return osmuPassword;}
    public ConnectionStatus getConnectionStatus(){return connectionStatus;} public Instant getLastTestedAt(){return lastTestedAt;} public Long getLastTestLatencyMs(){return lastTestLatencyMs;} public String getLastTestError(){return lastTestError;} public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;} public Long getVersion(){return version;}
}