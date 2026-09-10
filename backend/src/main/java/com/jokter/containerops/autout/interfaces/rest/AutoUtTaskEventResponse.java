package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.domain.model.AutoUtTaskEvent;

import java.time.Instant;

public record AutoUtTaskEventResponse(Instant time, String status, String message) {
    static AutoUtTaskEventResponse from(AutoUtTaskEvent event) {
        return new AutoUtTaskEventResponse(event.time(), event.status().name(), event.message());
    }
}
