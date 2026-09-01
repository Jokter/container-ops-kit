package com.jokter.containerops.containerresource.application;

public class ContainerResourceConflictException extends RuntimeException {
    public ContainerResourceConflictException() {
        super("环境中的资源已发生变化，请重新读取后再修改");
    }
}
