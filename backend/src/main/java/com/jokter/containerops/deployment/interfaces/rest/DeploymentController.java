package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.deployment.application.DeploymentApplicationService;
import com.jokter.containerops.deployment.application.DeploymentEvent;
import com.jokter.containerops.deployment.application.DeploymentPreparationStore;
import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;
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
    private final DeploymentPreparationStore store;

    public DeploymentController(DeploymentApplicationService deployments, DeploymentPreparationStore store) {
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

    @PostMapping("/deployment-preparations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DeploymentPreparationResponse create(@Valid @RequestBody CreateDeploymentPreparationRequest request) {
        return DeploymentPreparationResponse.from(deployments.create(request.toCommand()));
    }

    @GetMapping("/deployment-preparations/{id}")
    public DeploymentPreparationResponse get(@PathVariable String id) {
        return DeploymentPreparationResponse.from(deployments.get(id));
    }

    @PutMapping("/deployment-preparations/{id}/services/{service}/values")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateValues(@PathVariable String id, @PathVariable String service, @Valid @RequestBody UpdateValuesRequest request) {
        deployments.updateValues(id, service, request.values());
    }

    @PostMapping("/deployment-preparations/{id}/apply")
    public DeploymentPreparationResponse apply(@PathVariable String id) {
        deployments.apply(id);
        return DeploymentPreparationResponse.from(deployments.get(id));
    }

    @PostMapping("/deployment-preparations/{id}/render")
    public DeploymentPreparationResponse render(@PathVariable String id) {
        deployments.render(id);
        return DeploymentPreparationResponse.from(deployments.get(id));
    }

    @PostMapping("/deployment-preparations/{id}/confirmation")
    public ConfirmationResponse confirmation(@PathVariable String id) {
        DeploymentPreparation preparation = deployments.get(id);
        return new ConfirmationResponse(preparation.revision(), deployments.confirmation(id));
    }

    @PostMapping("/deployment-preparations/{id}/deploy")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void deploy(@PathVariable String id, @Valid @RequestBody DeployRequest request) {
        deployments.deploy(id, request.revision(), request.confirmationToken());
    }

    @GetMapping(path = "/deployment-preparations/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String id, @RequestHeader(value = "Last-Event-ID", defaultValue = "0") long lastEventId) {
        deployments.get(id);
        SseEmitter emitter = new SseEmitter(0L);
        AtomicReference<Runnable> cancel = new AtomicReference<>(() -> { });
        Consumer<DeploymentEvent> listener = event -> send(emitter, cancel, event);
        Runnable unsubscribe = store.subscribe(id, lastEventId, listener);
        cancel.set(unsubscribe);
        emitter.onCompletion(unsubscribe);
        emitter.onTimeout(unsubscribe);
        emitter.onError(ignored -> unsubscribe.run());
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
