package com.jokter.containerops.deployment.application;

import java.time.Instant;

public record DeploymentEvent(long sequence, Instant occurredAt, String stage, String service, String message) {
}
