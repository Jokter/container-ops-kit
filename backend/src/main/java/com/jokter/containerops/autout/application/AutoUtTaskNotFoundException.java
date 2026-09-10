package com.jokter.containerops.autout.application;

public class AutoUtTaskNotFoundException extends RuntimeException {
    public AutoUtTaskNotFoundException() {
        super("Auto-UT 任务不存在");
    }
}
