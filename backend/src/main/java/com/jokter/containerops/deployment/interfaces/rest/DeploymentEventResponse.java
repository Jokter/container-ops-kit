package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentEvent;

import java.time.Instant;

public record DeploymentEventResponse(long sequence, Instant occurredAt, String stage, String service, String message) {
    static DeploymentEventResponse from(DeploymentEvent source) {
        return new DeploymentEventResponse(source.sequence(), source.occurredAt(), source.stage(), source.service(), source.message());
    }
}
