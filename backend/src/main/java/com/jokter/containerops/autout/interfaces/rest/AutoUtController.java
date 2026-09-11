package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.autout.application.AutoUtApplicationService;
import com.jokter.containerops.autout.application.AutoUtLiveEventStream;
import com.jokter.containerops.autout.application.AutoUtRepositoryCatalog;
import com.jokter.containerops.autout.application.AutoUtWorkspaceDirectoryService;
import com.jokter.containerops.autout.application.AutoUtScheduleService;
import com.jokter.containerops.autout.domain.model.AutoUtExecutionMode;
import com.jokter.containerops.autout.domain.model.AutoUtLiveEvent;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

@RestController
public class AutoUtController {
    private final AutoUtApplicationService autoUt;
    private final AutoUtWorkspaceDirectoryService workspaceDirectories;
    private final AutoUtScheduleService schedules;
    private final AutoUtLiveEventStream liveEvents;
    private final AutoUtRepositoryCatalog repositoryCatalog;

    public AutoUtController(
            AutoUtApplicationService autoUt,
            AutoUtWorkspaceDirectoryService workspaceDirectories,
            AutoUtScheduleService schedules,
            AutoUtLiveEventStream liveEvents,
            AutoUtRepositoryCatalog repositoryCatalog
    ) {
        this.autoUt = autoUt;
        this.workspaceDirectories = workspaceDirectories;
        this.schedules = schedules;
        this.liveEvents = liveEvents;
        this.repositoryCatalog = repositoryCatalog;
    }

    @PostMapping(path = "/api/auto-ut/scan", consumes = "multipart/form-data")
    public List<AutoUtPlanResponse> scan(
            @RequestParam MultipartFile report,
            @RequestParam String username,
            @RequestParam String ticket,
            @RequestParam String baseBranch
    ) throws IOException {
        return autoUt.scan(report.getBytes(), username, ticket, baseBranch).stream()
                .map(AutoUtPlanResponse::from).toList();
    }

    @PostMapping(path = "/api/auto-ut/tasks", consumes = "multipart/form-data")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public List<AutoUtTaskResponse> start(
            @RequestParam MultipartFile report,
            @RequestParam String username,
            @RequestParam String ticket,
            @RequestParam String baseBranch,
            @RequestParam String workspaceRoot,
            @RequestParam AutoUtExecutionMode executionMode
    ) throws IOException {
        return autoUt.start(report.getBytes(), username, ticket, baseBranch, workspaceRoot, executionMode).stream()
                .map(AutoUtTaskResponse::from).toList();
    }

    @GetMapping("/api/auto-ut/tasks")
    public List<AutoUtTaskResponse> tasks() {
        return autoUt.findAll().stream().map(AutoUtTaskResponse::from).toList();
    }

    @GetMapping("/api/auto-ut/tasks/{id}")
    public AutoUtTaskResponse task(@PathVariable String id) {
        return AutoUtTaskResponse.from(autoUt.get(id));
    }

    @PutMapping("/api/auto-ut/repositories/{repository}")
    public AutoUtRepositoryMappingResponse saveRepository(
            @PathVariable String repository,
            @RequestBody AutoUtRepositoryMappingRequest request
    ) {
        return AutoUtRepositoryMappingResponse.from(repository, repositoryCatalog.save(repository, request.url()));
    }

    @GetMapping(path = "/api/auto-ut/tasks/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(
            @PathVariable String id,
            @RequestHeader(value = "Last-Event-ID", defaultValue = "0") long lastEventId,
            @RequestParam(defaultValue = "0") long afterSequence
    ) {
        autoUt.get(id);
        SseEmitter emitter = new SseEmitter(0L);
        AtomicReference<Runnable> cancel = new AtomicReference<>(() -> { });
        AtomicBoolean disconnected = new AtomicBoolean();
        Consumer<AutoUtLiveEvent> listener = event -> {
            try {
                emitter.send(SseEmitter.event().id(Long.toString(event.sequence())).data(AutoUtLiveEventResponse.from(event)));
            } catch (IOException exception) {
                disconnected.set(true);
                cancel.get().run();
                emitter.completeWithError(exception);
            }
        };
        Runnable unsubscribe = liveEvents.subscribe(id, Math.max(lastEventId, afterSequence), listener);
        cancel.set(unsubscribe);
        if (disconnected.get()) unsubscribe.run();
        emitter.onCompletion(unsubscribe);
        emitter.onTimeout(unsubscribe);
        emitter.onError(ignored -> unsubscribe.run());
        return emitter;
    }

    @PostMapping("/api/auto-ut/tasks/{id}/continuation")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AutoUtTaskResponse continueTask(@PathVariable String id) {
        return AutoUtTaskResponse.from(autoUt.continueTask(id));
    }

    @GetMapping("/api/auto-ut/workspace-directories")
    public AutoUtWorkspaceDirectoryService.DirectoryListing workspaceDirectories(
            @RequestParam(required = false) String path
    ) {
        return workspaceDirectories.browse(path);
    }

    @GetMapping("/api/auto-ut/schedule")
    public ResponseEntity<AutoUtScheduleResponse> schedule() {
        return schedules.get().map(schedule -> ResponseEntity.ok(AutoUtScheduleResponse.from(schedule)))
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PutMapping(path = "/api/auto-ut/schedule", consumes = "multipart/form-data")
    public AutoUtScheduleResponse saveSchedule(
            @RequestParam MultipartFile report,
            @RequestParam String username,
            @RequestParam String ticket,
            @RequestParam String baseBranch,
            @RequestParam String workspaceRoot,
            @RequestParam String dailyTime
    ) throws IOException {
        return AutoUtScheduleResponse.from(schedules.save(
                report.getOriginalFilename(), report.getBytes(), username, ticket, baseBranch, workspaceRoot, dailyTime));
    }

    @DeleteMapping("/api/auto-ut/schedule")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSchedule() {
        schedules.delete();
    }
}
