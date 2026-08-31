package com.jokter.containerops.application;

import com.jokter.containerops.api.*;
import com.jokter.containerops.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class EnvironmentService {
    private final EnvironmentRepository environments;
    private final ReleaseVersionRepository versions;
    private final SshConnectionTester tester;

    public EnvironmentService(EnvironmentRepository environments, ReleaseVersionRepository versions, SshConnectionTester tester) {
        this.environments = environments; this.versions = versions; this.tester = tester;
    }

    public List<Environment> list() { return environments.findAllByOrderByUpdatedAtDesc(); }
    public Environment get(Long id) { return environments.findById(id).orElseThrow(() -> new IllegalArgumentException("环境不存在")); }

    @Transactional
    public Environment create(EnvironmentRequest request) {
        Environment e = new Environment();
        e.create(version(request.releaseVersionId()), request.type(), request.name(), request.host(), request.sshPort(), request.password(), request.workDirectory(), request.architecture(), request.mae(), request.maeUser(), request.maePassword(), request.osmu(), request.osmuUser(), request.osmuPassword());
        return environments.save(e);
    }

    @Transactional
    public Environment update(Long id, EnvironmentRequest request) {
        Environment e = get(id);
        if (request.version() == null || !request.version().equals(e.getVersion())) throw new ConcurrentModificationException();
        e.update(version(request.releaseVersionId()), request.type(), request.name(), request.host(), request.sshPort(), request.password(), request.workDirectory(), request.architecture(), request.mae(), request.maeUser(), request.maePassword(), request.osmu(), request.osmuUser(), request.osmuPassword());
        return environments.save(e);
    }

    @Transactional
    public void delete(Long id) { environments.delete(get(id)); }

    public ConnectionTestResult preview(ConnectionTestRequest request) { return tester.test(request); }

    @Transactional
    public ConnectionTestResult test(Long id) {
        Environment e = get(id);
        ConnectionTestResult result = tester.test(new ConnectionTestRequest(e.getType(), e.getHost(), e.getSshPort(), e.getPassword()));
        e.markTest(result.status(), result.latencyMs(), result.error());
        environments.save(e);
        return result;
    }

    @Transactional
    public List<ConnectionTestResult> testAll() {
        return list().stream().map(e -> test(e.getId())).toList();
    }

    private ReleaseVersion version(Long id) { return versions.findById(id).orElseThrow(() -> new IllegalArgumentException("发布版本不存在")); }
}