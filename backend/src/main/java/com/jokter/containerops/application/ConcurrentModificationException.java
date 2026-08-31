package com.jokter.containerops.application;

public class ConcurrentModificationException extends RuntimeException {
    public ConcurrentModificationException() { super("环境已被其他请求修改，请刷新后重试"); }
}