package com.jokter.containerops.autout.infrastructure.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.time.Clock;
import java.time.ZoneId;

@Configuration
@EnableScheduling
public class AutoUtSchedulingConfiguration {
    @Bean
    Clock autoUtClock() {
        return Clock.system(ZoneId.of("Asia/Shanghai"));
    }
}
