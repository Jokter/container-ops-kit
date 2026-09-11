package com.jokter.containerops.autout.infrastructure.workflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.jokter.containerops.autout.application.AutoUtLiveEventStream;

final class PiRpcEventMapper {
    private final AutoUtLiveEventStream events;

    PiRpcEventMapper(AutoUtLiveEventStream events) {
        this.events = events;
    }

    void status(String taskId, String content) {
        emit(taskId, "status", content, "", "", false, false);
    }

    boolean publish(String taskId, JsonNode event) {
        String type = event.path("type").asText();
        if (type.equals("agent_start")) {
            emit(taskId, "status", "Pi 已开始分析", "", "", false, false);
        } else if (type.equals("agent_settled")
                || (type.equals("agent_end") && !event.path("willRetry").asBoolean())) {
            emit(taskId, "completed", "Pi 执行完成", "", "", false, false);
        } else if (type.equals("message_update")) {
            assistantUpdate(taskId, event.path("assistantMessageEvent"));
        } else if (type.equals("tool_execution_start")) {
            emit(taskId, "tool_start", event.path("args").toString(), event.path("toolCallId").asText(),
                    event.path("toolName").asText(), false, false);
        } else if (type.equals("tool_execution_update")) {
            emit(taskId, "tool_output", content(event.path("partialResult")), event.path("toolCallId").asText(),
                    event.path("toolName").asText(), false, true);
        } else if (type.equals("tool_execution_end")) {
            emit(taskId, "tool_end", content(event.path("result")), event.path("toolCallId").asText(),
                    event.path("toolName").asText(), event.path("isError").asBoolean(), true);
        } else if (type.equals("extension_error")) {
            emit(taskId, "error", errorText(event.path("error"), "Pi 扩展执行失败"), "", "", true, false);
            return false;
        } else if (type.equals("response") && !event.path("success").asBoolean(true)) {
            emit(taskId, "error", errorText(event.path("error"), "Pi 拒绝执行修复请求"), "", "", true, false);
            return false;
        } else if (type.equals("message_end") && event.path("message").path("stopReason").asText().equals("error")) {
            emit(taskId, "error", event.path("message").path("errorMessage").asText("Pi 执行失败"), "", "", true, false);
            return false;
        }
        return true;
    }

    private void assistantUpdate(String taskId, JsonNode update) {
        String type = update.path("type").asText();
        if (type.equals("thinking_start")) emit(taskId, "thinking_start", "", "", "", false, false);
        if (type.equals("thinking_delta")) emit(taskId, "thinking_delta", update.path("delta").asText(), "", "", false, false);
        if (type.equals("thinking_end")) emit(taskId, "thinking_end", "", "", "", false, false);
        if (type.equals("text_start")) emit(taskId, "message_start", "", "", "", false, false);
        if (type.equals("text_delta")) emit(taskId, "message_delta", update.path("delta").asText(), "", "", false, false);
        if (type.equals("text_end")) emit(taskId, "message_end", "", "", "", false, false);
    }

    private String content(JsonNode result) {
        StringBuilder text = new StringBuilder();
        for (JsonNode item : result.path("content")) {
            if (item.path("type").asText().equals("text")) text.append(item.path("text").asText());
        }
        return text.toString();
    }

    private String errorText(JsonNode error, String fallback) {
        if (error.isTextual()) return error.asText();
        String message = error.path("message").asText();
        return message.isBlank() ? fallback : message;
    }

    private void emit(
            String taskId, String type, String content, String toolCallId,
            String toolName, boolean error, boolean replace
    ) {
        events.publish(taskId, type, content, toolCallId, toolName, error, replace);
    }
}
