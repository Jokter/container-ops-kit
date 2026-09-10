package com.jokter.containerops.autout.domain.model;

import java.time.Instant;

public record AutoUtTaskEvent(Instant time, AutoUtTaskStatus status, String message) {
}
