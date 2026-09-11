package com.jokter.containerops.autout.infrastructure.workflow;

import com.jokter.containerops.autout.application.AutoUtLiveEventStream;
import com.jokter.containerops.autout.domain.model.AutoUtLiveEvent;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

@Component
public class InMemoryAutoUtLiveEventStream implements AutoUtLiveEventStream {
    private static final int HISTORY_LIMIT = 10_000;
    private final Map<String, Channel> channels = new HashMap<>();

    @Override
    public AutoUtLiveEvent publish(
            String taskId, String type, String content, String toolCallId,
            String toolName, boolean error, boolean replace
    ) {
        Channel channel;
        synchronized (channels) {
            channel = channels.computeIfAbsent(taskId, ignored -> new Channel());
        }
        return channel.publish(type, content, toolCallId, toolName, error, replace);
    }

    @Override
    public Runnable subscribe(String taskId, long afterSequence, Consumer<AutoUtLiveEvent> listener) {
        Channel channel;
        synchronized (channels) {
            channel = channels.computeIfAbsent(taskId, ignored -> new Channel());
        }
        return channel.subscribe(afterSequence, listener);
    }

    private static final class Channel {
        private long sequence;
        private final List<AutoUtLiveEvent> history = new ArrayList<>();
        private final List<Consumer<AutoUtLiveEvent>> listeners = new ArrayList<>();

        synchronized AutoUtLiveEvent publish(
                String type, String content, String toolCallId, String toolName,
                boolean error, boolean replace
        ) {
            AutoUtLiveEvent event = new AutoUtLiveEvent(
                    ++sequence, Instant.now(), type, content == null ? "" : content,
                    toolCallId == null ? "" : toolCallId, toolName == null ? "" : toolName,
                    error, replace
            );
            if (replace && !event.toolCallId().isBlank()) {
                history.removeIf(previous -> previous.replace()
                        && previous.type().equals(event.type())
                        && previous.toolCallId().equals(event.toolCallId()));
            }
            history.add(event);
            if (history.size() > HISTORY_LIMIT) history.removeFirst();
            for (Consumer<AutoUtLiveEvent> listener : List.copyOf(listeners)) {
                try {
                    listener.accept(event);
                } catch (RuntimeException exception) {
                    listeners.remove(listener);
                }
            }
            return event;
        }

        synchronized Runnable subscribe(long afterSequence, Consumer<AutoUtLiveEvent> listener) {
            history.stream().filter(event -> event.sequence() > afterSequence).forEach(listener);
            listeners.add(listener);
            return () -> remove(listener);
        }

        private synchronized void remove(Consumer<AutoUtLiveEvent> listener) {
            listeners.remove(listener);
        }
    }
}
