package com.jokter.containerops.build.infrastructure.runtime;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Configuration
public class BuildExecutorConfiguration {
    @Bean(name = "buildExecutor", destroyMethod = "close")
    ExecutorService buildExecutor() {
        return Executors.newVirtualThreadPerTaskExecutor();
    }
}
