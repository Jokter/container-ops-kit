package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.*;
import com.jokter.containerops.environment.domain.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class EnvironmentApplicationService {
 private final EnvironmentRepository environments;private final ReleaseVersionRepository versions;private final SshConnectionPort ssh;
 public EnvironmentApplicationService(EnvironmentRepository environments,ReleaseVersionRepository versions,SshConnectionPort ssh){this.environments=environments;this.versions=versions;this.ssh=ssh;}
 public List<ReleaseVersion> versions(){return versions.findAll();}
 public List<Environment> environments(){return environments.findAll();}
 public Environment environment(Long id){return environments.findById(id).orElseThrow(()->new EnvironmentNotFoundException("环境不存在"));}
 @Transactional public Environment create(EnvironmentCommand c){return environments.save(Environment.create(version(c.releaseVersionId()),c.type(),c.name(),c.host(),c.sshPort(),c.password(),c.rootPassword(),c.workDirectory(),c.architecture(),c.businessPlaneUrl(),c.businessPlaneUser(),c.businessPlanePassword(),c.managementPlaneUrl(),c.managementPlaneUser(),c.managementPlanePassword()));}
 @Transactional public Environment update(Long id,EnvironmentCommand c){Environment e=environment(id);if(c.version()==null||!c.version().equals(e.getVersion()))throw new EnvironmentConflictException();e.update(version(c.releaseVersionId()),c.type(),c.name(),c.host(),c.sshPort(),c.password(),c.rootPassword(),c.workDirectory(),c.architecture(),c.businessPlaneUrl(),c.businessPlaneUser(),c.businessPlanePassword(),c.managementPlaneUrl(),c.managementPlaneUser(),c.managementPlanePassword());return environments.save(e);}
 @Transactional public void delete(Long id){environments.delete(environment(id));}
 public ConnectionTestResult preview(ConnectionTestCommand command){return ssh.test(command);}
 @Transactional public ConnectionTestResult test(Long id,SshUser user){Environment e=environment(id);ConnectionTestResult result=ssh.test(new ConnectionTestCommand(user,e.getHost(),e.getSshPort(),e.sshPassword(user)));e.markTest(result.status(),result.latencyMs(),result.error());environments.save(e);return result;}
 public List<ConnectionTestResult> testAll(){return environments().stream().map(environment->test(environment.getId(),environment.defaultSshUser())).toList();}
 private ReleaseVersion version(Long id){return versions.findById(id).orElseThrow(()->new EnvironmentNotFoundException("发布版本不存在"));}
}
