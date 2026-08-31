package com.jokter.containerops.api;

import com.jokter.containerops.application.ConcurrentModificationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Map<String,String> notFound(IllegalArgumentException ex){return Map.of("message",ex.getMessage());}
    @ExceptionHandler(ConcurrentModificationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public Map<String,String> conflict(ConcurrentModificationException ex){return Map.of("message",ex.getMessage());}
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String,String> invalid(MethodArgumentNotValidException ex){return Map.of("message","请求参数校验失败");}
}