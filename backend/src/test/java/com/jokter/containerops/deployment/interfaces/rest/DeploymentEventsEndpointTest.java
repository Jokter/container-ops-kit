package com.jokter.containerops.deployment.interfaces.rest;

import com.jokter.containerops.ContainerOpsKitApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = ContainerOpsKitApplication.class,
        properties = "spring.datasource.url=jdbc:h2:mem:deployment-events;DB_CLOSE_DELAY=-1"
)
@AutoConfigureMockMvc
class DeploymentEventsEndpointTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void closesExpiredDeploymentSubscriptionWithAnSseEvent() throws Exception {
        MvcResult result = mvc.perform(get("/api/deployment-preparations/missing/events")
                        .accept(MediaType.TEXT_EVENT_STREAM))
                .andExpect(request().asyncStarted())
                .andReturn();

        mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM))
                .andExpect(content().string(containsString("event:expired")))
                .andExpect(content().string(containsString("服务已重启")));
    }
}
