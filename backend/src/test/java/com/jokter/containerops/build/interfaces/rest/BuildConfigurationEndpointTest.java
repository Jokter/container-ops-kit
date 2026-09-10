package com.jokter.containerops.build.interfaces.rest;

import com.jokter.containerops.ContainerOpsKitApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = ContainerOpsKitApplication.class,
        properties = "spring.datasource.url=jdbc:h2:mem:build-configuration;DB_CLOSE_DELAY=-1"
)
@AutoConfigureMockMvc
class BuildConfigurationEndpointTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void exposesFixedRepositories() throws Exception {
        mvc.perform(get("/api/build-configuration"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cbbWebDevRepository").value("https://szv-y.codehub.huawei.com/MAE-M/Common/CBB-Web-Dev.git"))
                .andExpect(jsonPath("$.archDesignRepository").value("https://szv-y.codehub.huawei.com/MAE-M/CI/ArchDesign.git"));
    }
}
