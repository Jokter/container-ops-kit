package com.jokter.containerops.system.interfaces.rest;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
public class HealthController {
 @GetMapping("/api/health")
 public Map<String,String> health(){return Map.of("status","UP");}
}