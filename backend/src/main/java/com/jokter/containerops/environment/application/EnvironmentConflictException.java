package com.jokter.containerops.environment.application;

public class EnvironmentConflictException extends RuntimeException {
    public EnvironmentConflictException(){super("环境已被其他请求修改，请刷新后重试");}
}