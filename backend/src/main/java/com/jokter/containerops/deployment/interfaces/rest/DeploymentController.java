package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentApplicationService;
import com.jokter.containerops.deployment.application.DeploymentEvent;
import com.jokter.containerops.deployment.application.DeploymentNotFoundException;
import com.jokter.containerops.deployment.application.DeploymentTaskStore;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

@RestController
@RequestMapping("/api")
public class DeploymentController {
    private final DeploymentApplicationService deployments;
    private final DeploymentTaskStore store;

    public DeploymentController(DeploymentApplicationService deployments, DeploymentTaskStore store) {
        this.deployments = deployments;
        this.store = store;
    }

    @GetMapping("/deployment-candidates")
    public DeploymentCandidatesResponse candidates(
            @RequestParam Long artifactId,
            @RequestParam Long environmentId,
            @RequestParam(required = false) String namespace
    ) {
        return DeploymentCandidatesResponse.from(deployments.candidates(artifactId, environmentId, namespace));
    }

    @PostMapping("/deployment-tasks")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DeploymentTaskResponse create(@Valid @RequestBody CreateDeploymentTaskRequest request) {
        return DeploymentTaskResponse.from(deployments.create(request.toCommand()));
    }

    @GetMapping("/deployment-tasks/{id}")
    public DeploymentTaskResponse get(@PathVariable String id) {
        return DeploymentTaskResponse.from(deployments.get(id));
    }

    @PutMapping("/deployment-tasks/{id}/services/{service}/values")
    public DeploymentTaskResponse updateValues(@PathVariable String id, @PathVariable String service, @Valid @RequestBody UpdateValuesRequest request) {
        deployments.updateValues(id, service, request.values());
        return DeploymentTaskResponse.from(deployments.get(id));
    }

    @PostMapping("/deployment-tasks/{id}/execution")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DeploymentTaskResponse execute(@PathVariable String id, @Valid @RequestBody ExecuteDeploymentRequest request) {
        return DeploymentTaskResponse.from(deployments.execute(id, request.expectedRevision()));
    }

    @GetMapping(path = "/deployment-tasks/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8")
    public SseEmitter events(
            @PathVariable String id,
            @RequestHeader(value = "Last-Event-ID", defaultValue = "0") long lastEventId,
            @RequestParam(defaultValue = "0") long afterSequence
    ) {
        SseEmitter emitter = new SseEmitter(0L);
        try {
            deployments.get(id);
        } catch (DeploymentNotFoundException exception) {
            return expired(emitter, exception.getMessage());
        }
        AtomicReference<Runnable> cancel = new AtomicReference<>(() -> { });
        Consumer<DeploymentEvent> listener = event -> send(emitter, cancel, event);
        Runnable unsubscribe = store.subscribe(id, Math.max(lastEventId, afterSequence), listener);
        cancel.set(unsubscribe);
        emitter.onCompletion(unsubscribe);
        emitter.onTimeout(unsubscribe);
        emitter.onError(ignored -> unsubscribe.run());
        return emitter;
    }

    private SseEmitter expired(SseEmitter emitter, String message) {
        try {
            emitter.send(SseEmitter.event().name("expired").data(message));
            emitter.complete();
        } catch (IOException exception) {
            emitter.completeWithError(exception);
        }
        return emitter;
    }

    private void send(SseEmitter emitter, AtomicReference<Runnable> cancel, DeploymentEvent event) {
        try {
            emitter.send(SseEmitter.event().id(Long.toString(event.sequence())).data(DeploymentEventResponse.from(event)));
        } catch (IOException exception) {
            cancel.get().run();
            emitter.completeWithError(exception);
        }
    }
}
