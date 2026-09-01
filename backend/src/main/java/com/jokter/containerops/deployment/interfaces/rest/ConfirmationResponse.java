package com.jokter.containerops.deployment.interfaces.rest;

public record ConfirmationResponse(long revision, String confirmationToken) {
}
