package com.jokter.containerops.application;

import com.jokter.containerops.api.ConnectionTestRequest;
import com.jokter.containerops.api.ConnectionTestResult;
import com.jokter.containerops.domain.ConnectionStatus;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.keyverifier.AcceptAllServerKeyVerifier;
import org.apache.sshd.client.session.ClientSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.time.Instant;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.concurrent.TimeUnit;

@Component
public class SshConnectionTester {
    private final long connectTimeout;
    private final long authTimeout;

    public SshConnectionTester(@Value("${resource-center.ssh.connect-timeout:5000}") long connectTimeout,
                               @Value("${resource-center.ssh.auth-timeout:5000}") long authTimeout) {
        this.connectTimeout = connectTimeout;
        this.authTimeout = authTimeout;
    }

    public ConnectionTestResult test(ConnectionTestRequest request) {
        Instant started = Instant.now();
        String user = request.type() == com.jokter.containerops.domain.EnvironmentType.BUILD ? "huawei" : "sopuser";
        try (SshClient client = SshClient.setUpDefaultClient()) {
            client.setServerKeyVerifier(AcceptAllServerKeyVerifier.INSTANCE);
            client.start();
            try (ClientSession session = client.connect(user, request.host(), request.sshPort())
                    .verify(connectTimeout, TimeUnit.MILLISECONDS).getSession()) {
                session.addPasswordIdentity(request.password());
                session.auth().verify(authTimeout, TimeUnit.MILLISECONDS);
                return new ConnectionTestResult(ConnectionStatus.REACHABLE, elapsed(started), null);
            }
        } catch (Exception ex) {
            return new ConnectionTestResult(ConnectionStatus.FAILED, elapsed(started), classify(ex));
        }
    }

    private long elapsed(Instant started) {
        return Duration.between(started, Instant.now()).toMillis();
    }

    private String classify(Exception ex) {
        Throwable current = ex;
        while (current != null) {
            if (current instanceof UnknownHostException) return "地址无法解析";
            if (current instanceof ConnectException) return "端口拒绝连接";
            current = current.getCause();
        }
        String message = ex.getMessage() == null ? "" : ex.getMessage().toLowerCase();
        if (message.contains("timeout") || message.contains("timed out")) return "连接超时";
        if (message.contains("auth") || message.contains("password") || message.contains("denied")) return "账号或密码错误";
        if (message.contains("protocol")) return "SSH 协议错误";
        return "连接失败";
    }
}