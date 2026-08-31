package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.EnvironmentCommand;
import com.jokter.containerops.environment.domain.model.EnvironmentType;
import jakarta.validation.constraints.*;
import java.net.URI;

public record EnvironmentRequest(@NotNull Long releaseVersionId,@NotNull EnvironmentType type,@NotBlank String name,@NotBlank String host,@NotNull @Min(1) @Max(65535) Integer sshPort,@NotBlank String password,String rootPassword,String workDirectory,String architecture,String businessPlaneUrl,String businessPlaneUser,String businessPlanePassword,String managementPlaneUrl,String managementPlaneUser,String managementPlanePassword,Long version){
 @AssertTrue(message="容器环境必须配置 root 密码") public boolean isRootPasswordValid(){return type!=EnvironmentType.CONTAINER||rootPassword!=null&&!rootPassword.isBlank();}
 @AssertTrue(message="业务面地址、账号和密码需要同时填写") public boolean isBusinessPlaneValid(){return completeOptionalGroup(businessPlaneUrl,businessPlaneUser,businessPlanePassword)&&validWebUrl(businessPlaneUrl);}
 @AssertTrue(message="管理面地址、账号和密码需要同时填写") public boolean isManagementPlaneValid(){return completeOptionalGroup(managementPlaneUrl,managementPlaneUser,managementPlanePassword)&&validWebUrl(managementPlaneUrl);}
 EnvironmentCommand toCommand(){return new EnvironmentCommand(releaseVersionId,type,name,host,sshPort,password,rootPassword,workDirectory,architecture,businessPlaneUrl,businessPlaneUser,businessPlanePassword,managementPlaneUrl,managementPlaneUser,managementPlanePassword,version);}
 private boolean completeOptionalGroup(String address,String user,String password){int count=0;if(address!=null&&!address.isBlank())count++;if(user!=null&&!user.isBlank())count++;if(password!=null&&!password.isBlank())count++;return count==0||count==3;}
 private boolean validWebUrl(String value){if(value==null||value.isBlank())return true;try{URI uri=URI.create(value);return ("http".equalsIgnoreCase(uri.getScheme())||"https".equalsIgnoreCase(uri.getScheme()))&&uri.getHost()!=null;}catch(IllegalArgumentException exception){return false;}}
}
