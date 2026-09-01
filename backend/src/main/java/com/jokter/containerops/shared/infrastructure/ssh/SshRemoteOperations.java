package com.jokter.containerops.shared.infrastructure.ssh;

import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelExec;
import org.apache.sshd.client.channel.ClientChannelEvent;
import org.apache.sshd.client.session.ClientSession;
import org.apache.sshd.sftp.client.SftpClient;
import org.apache.sshd.sftp.client.SftpClientFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

@Component
public class SshRemoteOperations {
    private final long connectTimeout;
    private final long authTimeout;

    public SshRemoteOperations(
            @Value("${resource-center.ssh.connect-timeout:5000}") long connectTimeout,
            @Value("${resource-center.ssh.auth-timeout:5000}") long authTimeout
    ) {
        this.connectTimeout = connectTimeout;
        this.authTimeout = authTimeout;
    }

    public SshExecution execute(SshEndpoint endpoint, String command, long timeout, Consumer<String> output) {
        try (SshClient client = SshClient.setUpDefaultClient()) {
            client.start();
            try (ClientSession session = connect(client, endpoint);
                 ChannelExec channel = session.createExecChannel("bash -lc " + quote(command))) {
                LineOutputStream stdout = new LineOutputStream(output, "");
                LineOutputStream stderr = new LineOutputStream(output, "[stderr] ");
                channel.setOut(stdout);
                channel.setErr(stderr);
                channel.open().verify(connectTimeout, TimeUnit.MILLISECONDS);
                Set<ClientChannelEvent> events = channel.waitFor(EnumSet.of(ClientChannelEvent.CLOSED), timeout);
                stdout.finish();
                stderr.finish();
                if (!events.contains(ClientChannelEvent.CLOSED)) {
                    channel.close(true);
                    output.accept("远程命令执行超时");
                    return new SshExecution(124);
                }
                Integer exitStatus = channel.getExitStatus();
                return new SshExecution(exitStatus == null ? 255 : exitStatus);
            }
        } catch (Exception exception) {
            throw new IllegalStateException("SSH 远程操作失败：" + failureMessage(exception), exception);
        }
    }

    public String readText(SshEndpoint endpoint, String path, long timeout) {
        StringBuilder content = new StringBuilder();
        SshExecution result = execute(endpoint, "cat " + quote(path), timeout, line -> content.append(line).append('\n'));
        if (result.exitCode() != 0) {
            throw new IllegalStateException("远程文件读取失败：" + path);
        }
        return content.toString();
    }

    public void uploadFiles(SshEndpoint endpoint, String remoteDirectory, Map<String, byte[]> files, long timeout) {
        String directories = files.keySet().stream()
                .map(path -> remoteDirectory + "/" + path)
                .map(path -> path.substring(0, path.lastIndexOf('/')))
                .distinct()
                .map(SshRemoteOperations::quote)
                .reduce((left, right) -> left + " " + right)
                .orElse(quote(remoteDirectory));
        SshExecution mkdir = execute(endpoint, "mkdir -p " + directories, timeout, ignored -> { });
        if (mkdir.exitCode() != 0) {
            throw new IllegalStateException("远程目录创建失败");
        }
        try (SshClient client = SshClient.setUpDefaultClient()) {
            client.start();
            try (ClientSession session = connect(client, endpoint);
                 SftpClient sftp = SftpClientFactory.instance().createSftpClient(session)) {
                for (Map.Entry<String, byte[]> file : files.entrySet()) {
                    String remotePath = remoteDirectory + "/" + file.getKey();
                    try (OutputStream stream = sftp.write(remotePath, EnumSet.of(SftpClient.OpenMode.Create, SftpClient.OpenMode.Truncate, SftpClient.OpenMode.Write))) {
                        stream.write(file.getValue());
                    }
                }
            }
        } catch (Exception exception) {
            throw new IllegalStateException("SFTP 文件上传失败：" + failureMessage(exception), exception);
        }
    }

    private ClientSession connect(SshClient client, SshEndpoint endpoint) throws IOException {
        ClientSession session = client.connect(endpoint.username(), endpoint.host(), endpoint.port())
                .verify(connectTimeout, TimeUnit.MILLISECONDS)
                .getSession();
        session.addPasswordIdentity(endpoint.password());
        session.auth().verify(authTimeout, TimeUnit.MILLISECONDS);
        return session;
    }

    public static String quote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private String failureMessage(Exception exception) {
        Throwable current = exception;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? current.getClass().getSimpleName() : current.getMessage();
    }

    private static final class LineOutputStream extends OutputStream {
        private final Consumer<String> output;
        private final String prefix;
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        private LineOutputStream(Consumer<String> output, String prefix) {
            this.output = output;
            this.prefix = prefix;
        }

        @Override
        public synchronized void write(int value) {
            if (value == '\n') {
                emit();
            } else if (value != '\r') {
                buffer.write(value);
            }
        }

        @Override
        public synchronized void write(byte[] values, int offset, int length) {
            for (int index = offset; index < offset + length; index++) {
                write(values[index]);
            }
        }

        @Override
        public synchronized void close() throws IOException {
            emit();
            super.close();
        }

        private void emit() {
            if (buffer.size() > 0) {
                output.accept(prefix + buffer.toString(StandardCharsets.UTF_8));
                buffer.reset();
            }
        }

        private synchronized void finish() {
            emit();
        }
    }
}
