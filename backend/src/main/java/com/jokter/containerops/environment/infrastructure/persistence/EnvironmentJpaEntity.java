package com.jokter.containerops.environment.infrastructure.persistence;

import com.jokter.containerops.environment.domain.model.*;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="environment")
public class EnvironmentJpaEntity {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(fetch=FetchType.EAGER,optional=false) @JoinColumn(name="release_version_id") ReleaseVersionJpaEntity releaseVersion;
 @Enumerated(EnumType.STRING) @Column(nullable=false) EnvironmentType type;
 @Column(nullable=false) String name;
 @Column(nullable=false) String host;
 @Column(name="ssh_port",nullable=false) Integer sshPort;
 @Column(nullable=false) String password;
 @Column(name="work_directory") String workDirectory;
 String architecture;String mae;
 @Column(name="mae_user") String maeUser;
 @Column(name="mae_password") String maePassword;
 String osmu;
 @Column(name="osmu_user") String osmuUser;
 @Column(name="osmu_password") String osmuPassword;
 @Enumerated(EnumType.STRING) @Column(name="connection_status",nullable=false) ConnectionStatus connectionStatus;
 @Column(name="last_tested_at") Instant lastTestedAt;
 @Column(name="last_test_latency_ms") Long lastTestLatencyMs;
 @Column(name="last_test_error") String lastTestError;
 @Column(name="created_at",nullable=false) Instant createdAt;
 @Column(name="updated_at",nullable=false) Instant updatedAt;
 @Version @Column(nullable=false) Long version;
 protected EnvironmentJpaEntity(){}

 void apply(Environment e,ReleaseVersionJpaEntity rv){
  releaseVersion=rv;type=e.getType();name=e.getName();host=e.getHost();sshPort=e.getSshPort();password=e.getPassword();workDirectory=e.getWorkDirectory();architecture=e.getArchitecture();
  mae=e.getMae();maeUser=e.getMaeUser();maePassword=e.getMaePassword();osmu=e.getOsmu();osmuUser=e.getOsmuUser();osmuPassword=e.getOsmuPassword();connectionStatus=e.getConnectionStatus();
  lastTestedAt=e.getLastTestedAt();lastTestLatencyMs=e.getLastTestLatencyMs();lastTestError=e.getLastTestError();createdAt=e.getCreatedAt();updatedAt=e.getUpdatedAt();
 }
 Environment toDomain(){return Environment.restore(id,releaseVersion.toDomain(),type,name,host,sshPort,password,workDirectory,architecture,mae,maeUser,maePassword,osmu,osmuUser,osmuPassword,connectionStatus,lastTestedAt,lastTestLatencyMs,lastTestError,createdAt,updatedAt,version);}
}