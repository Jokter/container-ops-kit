package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class DeploymentExceptionHandler {
    @ExceptionHandler(DeploymentNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Map<String, String> notFound(DeploymentNotFoundException exception) {
        return Map.of("message", exception.getMessage());
    }

    @ExceptionHandler(IllegalStateException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public Map<String, String> conflict(IllegalStateException exception) {
        return Map.of("message", exception.getMessage());
    }
}
