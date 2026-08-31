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
    public Long getId(){return id;} public ReleaseVersion getReleaseVersion(){return releaseVersion;} public EnvironmentType getType(){return type;}
    public String getName(){return name;} public String getHost(){return host;} public Integer getSshPort(){return sshPort;} public String getPassword(){return password;}
    public String getWorkDirectory(){return workDirectory;} public String getArchitecture(){return architecture;} public String getMae(){return mae;} public String getMaeUser(){return maeUser;} public String getMaePassword(){return maePassword;} public String getOsmu(){return osmu;} public String getOsmuUser(){return osmuUser;} public String getOsmuPassword(){return osmuPassword;}
    public ConnectionStatus getConnectionStatus(){return connectionStatus;} public Instant getLastTestedAt(){return lastTestedAt;} public Long getLastTestLatencyMs(){return lastTestLatencyMs;} public String getLastTestError(){return lastTestError;} public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;} public Long getVersion(){return version;}
    public void create(ReleaseVersion v, EnvironmentType t, String n, String h, Integer p, String pwd, String wd, String arch, String mae, String maeUser, String maePwd, String osmu, String osmuUser, String osmuPwd){
        releaseVersion=v; type=t; name=n; host=h; sshPort=p; password=pwd; workDirectory=wd; architecture=arch; this.mae=mae; this.maeUser=maeUser; maePassword=maePwd; this.osmu=osmu; this.osmuUser=osmuUser; osmuPassword=osmuPwd; connectionStatus=ConnectionStatus.UNTESTED; createdAt=Instant.now(); updatedAt=createdAt; version=0L;
    }
    public void update(ReleaseVersion v, EnvironmentType t, String n, String h, Integer p, String pwd, String wd, String arch, String mae, String maeUser, String maePwd, String osmu, String osmuUser, String osmuPwd){
        boolean changed=!host.equals(h)||!sshPort.equals(p)||!password.equals(pwd); create(v,t,n,h,p,pwd,wd,arch,mae,maeUser,maePwd,osmu,osmuUser,osmuPwd); if(!changed){connectionStatus=connectionStatus;} updatedAt=Instant.now();
    }
    public void markTest(ConnectionStatus s, long latency, String error){connectionStatus=s; lastTestedAt=Instant.now(); lastTestLatencyMs=latency; lastTestError=error; updatedAt=Instant.now();}
}