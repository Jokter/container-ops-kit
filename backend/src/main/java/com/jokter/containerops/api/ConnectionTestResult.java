package com.jokter.containerops.api;

import com.jokter.containerops.domain.ConnectionStatus;

public record ConnectionTestResult(ConnectionStatus status, Long latencyMs, String error) {}