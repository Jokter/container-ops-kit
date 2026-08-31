package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestControllerAdvice
public class EnvironmentExceptionHandler {
 @ExceptionHandler(EnvironmentNotFoundException.class) @ResponseStatus(HttpStatus.NOT_FOUND) public Map<String,String> notFound(EnvironmentNotFoundException e){return Map.of("message",e.getMessage());}
 @ExceptionHandler(EnvironmentConflictException.class) @ResponseStatus(HttpStatus.CONFLICT) public Map<String,String> conflict(EnvironmentConflictException e){return Map.of("message",e.getMessage());}
 @ExceptionHandler(IllegalArgumentException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) public Map<String,String> invalidArgument(IllegalArgumentException e){return Map.of("message",e.getMessage());}
 @ExceptionHandler(MethodArgumentNotValidException.class) @ResponseStatus(HttpStatus.BAD_REQUEST) public Map<String,String> invalid(){return Map.of("message","请求参数校验失败");}
}
