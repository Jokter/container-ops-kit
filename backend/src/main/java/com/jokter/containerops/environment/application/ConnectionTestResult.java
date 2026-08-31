package com.jokter.containerops.environment.application;

import com.jokter.containerops.environment.domain.model.ConnectionStatus;

public record ConnectionTestResult(ConnectionStatus status,Long latencyMs,String error) {}