package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.build.application.BuildApplicationService;
import com.jokter.containerops.build.application.BuildEventStream;
import com.jokter.containerops.build.application.BuildModuleCatalog;
import com.jokter.containerops.build.domain.model.BuildEvent;
import com.jokter.containerops.build.domain.model.BuildStatus;
import com.jokter.containerops.build.domain.model.BuildTask;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.List;

@RestController
@RequestMapping("/api")
public class BuildController {
    private final BuildApplicationService builds;
    private final BuildEventStream events;
    private final BuildModuleCatalog modules;

    public BuildController(BuildApplicationService builds, BuildEventStream events, BuildModuleCatalog modules) {
        this.builds = builds;
        this.events = events;
        this.modules = modules;
    }

    @GetMapping("/build-configuration")
    public BuildConfigurationResponse configuration() {
        return BuildConfigurationResponse.fixed(modules.findAll());
    }

    @GetMapping("/build-artifacts")
    public List<BuildArtifactResponse> artifacts() {
        return builds.findDeployableArtifacts().stream().map(BuildArtifactResponse::from).toList();
    }

    @PostMapping("/build-tasks")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public BuildTaskResponse start(@Valid @RequestBody StartBuildRequest request) {
        return BuildTaskResponse.from(builds.start(request.toCommand()));
    }

    @GetMapping("/build-tasks/{id}")
    public BuildTaskResponse get(@PathVariable String id) {
        return BuildTaskResponse.from(builds.get(id));
    }

    @GetMapping("/build-tasks")
    public List<BuildTaskSummaryResponse> tasks() {
        return builds.findAll().stream().map(BuildTaskSummaryResponse::from).toList();
    }

    @DeleteMapping("/build-tasks/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean deleteWorkspace
    ) {
        builds.delete(id, deleteWorkspace);
    }

    @GetMapping("/build-environments/{id}/storage")
    public BuildStorageUsageResponse storage(@PathVariable Long id) {
        return BuildStorageUsageResponse.from(builds.storage(id));
    }

    @GetMapping(path = "/build-tasks/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(
            @PathVariable String id,
            @RequestHeader(value = "Last-Event-ID", defaultValue = "0") long lastEventId
    ) {
        BuildTask task = builds.get(id);
        SseEmitter emitter = new SseEmitter(0L);
        AtomicReference<Runnable> cancel = new AtomicReference<>(() -> { });
        Consumer<BuildEvent> listener = event -> send(emitter, cancel, event);
        Runnable unsubscribe = events.subscribe(id, lastEventId, listener);
        cancel.set(unsubscribe);
        emitter.onCompletion(unsubscribe);
        emitter.onTimeout(unsubscribe);
        emitter.onError(ignored -> unsubscribe.run());
        if (task.status().terminal()) {
            unsubscribe.run();
            emitter.complete();
        }
        return emitter;
    }

    private void send(SseEmitter emitter, AtomicReference<Runnable> cancel, BuildEvent event) {
        try {
            emitter.send(SseEmitter.event().id(Long.toString(event.sequence())).data(BuildEventResponse.from(event)));
            if (event.taskStatus() == BuildStatus.SUCCEEDED || event.taskStatus() == BuildStatus.FAILED) {
                cancel.get().run();
                emitter.complete();
            }
        } catch (IOException exception) {
            cancel.get().run();
            emitter.completeWithError(exception);
        }
    }
}
