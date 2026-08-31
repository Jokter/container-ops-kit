package com.jokter.containerops.environment.application;

public class EnvironmentNotFoundException extends RuntimeException {
    public EnvironmentNotFoundException(String message){super(message);}
}