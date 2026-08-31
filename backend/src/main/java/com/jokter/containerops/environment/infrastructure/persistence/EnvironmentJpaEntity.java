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
 @Column(name="root_password") String rootPassword;
 @Column(name="work_directory") String workDirectory;
 String architecture;
 @Column(name="business_plane_url") String businessPlaneUrl;
 @Column(name="business_plane_user") String businessPlaneUser;
 @Column(name="business_plane_password") String businessPlanePassword;
 @Column(name="management_plane_url") String managementPlaneUrl;
 @Column(name="management_plane_user") String managementPlaneUser;
 @Column(name="management_plane_password") String managementPlanePassword;
 @Enumerated(EnumType.STRING) @Column(name="connection_status",nullable=false) ConnectionStatus connectionStatus;
 @Column(name="last_tested_at") Instant lastTestedAt;
 @Column(name="last_test_latency_ms") Long lastTestLatencyMs;
 @Column(name="last_test_error") String lastTestError;
 @Column(name="created_at",nullable=false) Instant createdAt;
 @Column(name="updated_at",nullable=false) Instant updatedAt;
 @Version @Column(nullable=false) Long version;
 protected EnvironmentJpaEntity(){}

 void apply(Environment e,ReleaseVersionJpaEntity rv){
  releaseVersion=rv;type=e.getType();name=e.getName();host=e.getHost();sshPort=e.getSshPort();password=e.getPassword();rootPassword=e.getRootPassword();workDirectory=e.getWorkDirectory();architecture=e.getArchitecture();
  businessPlaneUrl=e.getBusinessPlaneUrl();businessPlaneUser=e.getBusinessPlaneUser();businessPlanePassword=e.getBusinessPlanePassword();managementPlaneUrl=e.getManagementPlaneUrl();managementPlaneUser=e.getManagementPlaneUser();managementPlanePassword=e.getManagementPlanePassword();connectionStatus=e.getConnectionStatus();
  lastTestedAt=e.getLastTestedAt();lastTestLatencyMs=e.getLastTestLatencyMs();lastTestError=e.getLastTestError();createdAt=e.getCreatedAt();updatedAt=e.getUpdatedAt();
 }
 Environment toDomain(){return Environment.restore(id,releaseVersion.toDomain(),type,name,host,sshPort,password,rootPassword,workDirectory,architecture,businessPlaneUrl,businessPlaneUser,businessPlanePassword,managementPlaneUrl,managementPlaneUser,managementPlanePassword,connectionStatus,lastTestedAt,lastTestLatencyMs,lastTestError,createdAt,updatedAt,version);}
}
