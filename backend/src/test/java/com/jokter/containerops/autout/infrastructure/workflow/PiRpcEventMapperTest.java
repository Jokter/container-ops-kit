package com.jokter.containerops.autout.infrastructure.workflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jokter.containerops.autout.domain.model.AutoUtLiveEvent;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PiRpcEventMapperTest {
    private final ObjectMapper json = new ObjectMapper();
    private final InMemoryAutoUtLiveEventStream stream = new InMemoryAutoUtLiveEventStream();
    private final PiRpcEventMapper mapper = new PiRpcEventMapper(stream);

    @Test
    void 映射思考回答和工具执行事件() throws Exception {
        mapper.publish("task", json.readTree("""
                {"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"检查失败用例"}}
                """));
        mapper.publish("task", json.readTree("""
                {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"准备修改测试"}}
                """));
        mapper.publish("task", json.readTree("""
                {"type":"tool_execution_start","toolCallId":"call-1","toolName":"bash","args":{"command":"mvn test"}}
                """));
        mapper.publish("task", json.readTree("""
                {"type":"tool_execution_end","toolCallId":"call-1","toolName":"bash","isError":false,"result":{"content":[{"type":"text","text":"BUILD SUCCESS"}]}}
                """));

        List<AutoUtLiveEvent> events = new ArrayList<>();
        stream.subscribe("task", 0, events::add);

        assertThat(events).extracting(AutoUtLiveEvent::type)
                .containsExactly("thinking_delta", "message_delta", "tool_start", "tool_end");
        assertThat(events.getLast().content()).isEqualTo("BUILD SUCCESS");
        assertThat(events.getLast().toolName()).isEqualTo("bash");
    }
}
