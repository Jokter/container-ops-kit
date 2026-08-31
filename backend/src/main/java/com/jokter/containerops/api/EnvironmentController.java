package com.jokter.containerops.api;

import com.jokter.containerops.application.EnvironmentService;
import com.jokter.containerops.domain.*;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api")
public class EnvironmentController {
    private final EnvironmentService service;
    public EnvironmentController(EnvironmentService service) { this.service = service; }

    @GetMapping("/release-versions")
    public List<ReleaseVersion> versions() { return service.versions(); }

    @GetMapping("/environments")
    public List<Environment> list() { return service.list(); }

    @GetMapping("/environments/{id}")
    public Environment get(@PathVariable Long id) { return service.get(id); }

    @PostMapping("/environments")
    @ResponseStatus(HttpStatus.CREATED)
    public Environment create(@Valid @RequestBody EnvironmentRequest request) { return service.create(request); }

    @PutMapping("/environments/{id}")
    public Environment update(@PathVariable Long id, @Valid @RequestBody EnvironmentRequest request) { return service.update(id, request); }

    @DeleteMapping("/environments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) { service.delete(id); }

    @PostMapping("/connection-tests/preview")
    public ConnectionTestResult preview(@Valid @RequestBody ConnectionTestRequest request) { return service.preview(request); }

    @PostMapping("/environments/{id}/connection-test")
    public ConnectionTestResult test(@PathVariable Long id) { return service.test(id); }

    @PostMapping("/environments/connection-tests/batch")
    public List<ConnectionTestResult> testAll() { return service.testAll(); }
}