package com.jokter.containerops.environment.infrastructure.ssh;

import com.jokter.containerops.environment.application.*;
import com.jokter.containerops.environment.domain.model.*;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.session.ClientSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.*;
import java.time.*;
import java.util.concurrent.TimeUnit;

@Component
class ApacheMinaSshConnectionAdapter implements SshConnectionPort {
 private final long connectTimeout;private final long authTimeout;
 ApacheMinaSshConnectionAdapter(@Value("${resource-center.ssh.connect-timeout:5000}") long connectTimeout,@Value("${resource-center.ssh.auth-timeout:5000}") long authTimeout){this.connectTimeout=connectTimeout;this.authTimeout=authTimeout;}
 public ConnectionTestResult test(ConnectionTestCommand command){
  Instant started=Instant.now();String user=command.type()==EnvironmentType.BUILD?"huawei":"sopuser";
  try(SshClient client=SshClient.setUpDefaultClient()){
   client.start();
   try(ClientSession session=client.connect(user,command.host(),command.sshPort()).verify(connectTimeout,TimeUnit.MILLISECONDS).getSession()){
    session.addPasswordIdentity(command.password());session.auth().verify(authTimeout,TimeUnit.MILLISECONDS);
    return new ConnectionTestResult(ConnectionStatus.REACHABLE,elapsed(started),null);
   }
  }catch(Exception exception){return new ConnectionTestResult(ConnectionStatus.FAILED,elapsed(started),classify(exception));}
 }
 private long elapsed(Instant started){return Duration.between(started,Instant.now()).toMillis();}
 private String classify(Exception exception){
  Throwable current=exception;while(current!=null){if(current instanceof UnknownHostException)return "地址无法解析";if(current instanceof ConnectException)return "端口拒绝连接";current=current.getCause();}
  String message=exception.getMessage()==null?"":exception.getMessage().toLowerCase();if(message.contains("timeout")||message.contains("timed out"))return "连接超时";if(message.contains("auth")||message.contains("password")||message.contains("denied"))return "账号或密码错误";if(message.contains("protocol")||message.contains("key"))return "SSH 主机校验失败";return "连接失败";
 }
}