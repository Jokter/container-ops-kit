package com.jokter.containerops.environment.domain.model;

import java.time.Instant;

public class Environment {
    private Long id; private ReleaseVersion releaseVersion; private EnvironmentType type; private String name; private String host; private Integer sshPort; private String password;
    private String workDirectory; private String architecture; private String mae; private String maeUser; private String maePassword; private String osmu; private String osmuUser; private String osmuPassword;
    private ConnectionStatus connectionStatus; private Instant lastTestedAt; private Long lastTestLatencyMs; private String lastTestError; private Instant createdAt; private Instant updatedAt; private Long version;
    private Environment(){}

    public static Environment create(ReleaseVersion rv,EnvironmentType type,String name,String host,Integer port,String password,String workdir,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword){
        Environment e=new Environment(); e.releaseVersion=rv;e.type=type;e.name=name;e.host=host;e.sshPort=port;e.password=password;e.workDirectory=workdir;e.architecture=architecture;
        e.mae=mae;e.maeUser=maeUser;e.maePassword=maePassword;e.osmu=osmu;e.osmuUser=osmuUser;e.osmuPassword=osmuPassword;e.connectionStatus=ConnectionStatus.UNTESTED;e.createdAt=Instant.now();e.updatedAt=e.createdAt;return e;
    }
    public static Environment restore(Long id,ReleaseVersion rv,EnvironmentType type,String name,String host,Integer port,String password,String workdir,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword,ConnectionStatus status,Instant testedAt,Long latency,String error,Instant createdAt,Instant updatedAt,Long version){
        Environment e=create(rv,type,name,host,port,password,workdir,architecture,mae,maeUser,maePassword,osmu,osmuUser,osmuPassword);e.id=id;e.connectionStatus=status;e.lastTestedAt=testedAt;e.lastTestLatencyMs=latency;e.lastTestError=error;e.createdAt=createdAt;e.updatedAt=updatedAt;e.version=version;return e;
    }
    public void update(ReleaseVersion rv,EnvironmentType type,String name,String host,Integer port,String password,String workdir,String architecture,String mae,String maeUser,String maePassword,String osmu,String osmuUser,String osmuPassword){
        boolean changed=!this.host.equals(host)||!this.sshPort.equals(port)||!this.password.equals(password);this.releaseVersion=rv;this.type=type;this.name=name;this.host=host;this.sshPort=port;this.password=password;this.workDirectory=workdir;this.architecture=architecture;this.mae=mae;this.maeUser=maeUser;this.maePassword=maePassword;this.osmu=osmu;this.osmuUser=osmuUser;this.osmuPassword=osmuPassword;this.updatedAt=Instant.now();
        if(changed){connectionStatus=ConnectionStatus.UNTESTED;lastTestedAt=null;lastTestLatencyMs=null;lastTestError=null;}
    }
    public void markTest(ConnectionStatus status,long latency,String error){connectionStatus=status;lastTestedAt=Instant.now();lastTestLatencyMs=latency;lastTestError=error;updatedAt=Instant.now();}
    public Long getId(){return id;}public ReleaseVersion getReleaseVersion(){return releaseVersion;}public EnvironmentType getType(){return type;}public String getName(){return name;}public String getHost(){return host;}public Integer getSshPort(){return sshPort;}public String getPassword(){return password;}public String getWorkDirectory(){return workDirectory;}public String getArchitecture(){return architecture;}public String getMae(){return mae;}public String getMaeUser(){return maeUser;}public String getMaePassword(){return maePassword;}public String getOsmu(){return osmu;}public String getOsmuUser(){return osmuUser;}public String getOsmuPassword(){return osmuPassword;}public ConnectionStatus getConnectionStatus(){return connectionStatus;}public Instant getLastTestedAt(){return lastTestedAt;}public Long getLastTestLatencyMs(){return lastTestLatencyMs;}public String getLastTestError(){return lastTestError;}public Instant getCreatedAt(){return createdAt;}public Instant getUpdatedAt(){return updatedAt;}public Long getVersion(){return version;}
}