package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.application.*;
import com.jokter.containerops.environment.domain.model.ReleaseVersion;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api")
public class EnvironmentController {
 private final EnvironmentApplicationService service;
 public EnvironmentController(EnvironmentApplicationService service){this.service=service;}
 @GetMapping("/release-versions") public List<ReleaseVersion> versions(){return service.versions();}
 @GetMapping("/environments") public List<EnvironmentResponse> environments(){return service.environments().stream().map(EnvironmentResponse::from).toList();}
 @GetMapping("/environments/{id}") public EnvironmentResponse environment(@PathVariable Long id){return EnvironmentResponse.from(service.environment(id));}
 @PostMapping("/environments") @ResponseStatus(HttpStatus.CREATED) public EnvironmentResponse create(@Valid @RequestBody EnvironmentRequest request){return EnvironmentResponse.from(service.create(request.toCommand()));}
 @PutMapping("/environments/{id}") public EnvironmentResponse update(@PathVariable Long id,@Valid @RequestBody EnvironmentRequest request){return EnvironmentResponse.from(service.update(id,request.toCommand()));}
 @DeleteMapping("/environments/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void delete(@PathVariable Long id){service.delete(id);}
 @PostMapping("/connection-tests/preview") public ConnectionTestResult preview(@Valid @RequestBody ConnectionTestRequest request){return service.preview(request.toCommand());}
 @PostMapping("/environments/{id}/connection-test") public ConnectionTestResult test(@PathVariable Long id,@Valid @RequestBody SavedConnectionTestRequest request){return service.test(id,request.user());}
 @PostMapping("/environments/connection-tests/batch") public List<ConnectionTestResult> testAll(){return service.testAll();}
}
