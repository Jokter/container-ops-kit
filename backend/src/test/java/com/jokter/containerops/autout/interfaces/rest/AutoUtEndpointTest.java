package com.jokter.containerops.autout.interfaces.rest;

import com.jokter.containerops.ContainerOpsKitApplication;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = ContainerOpsKitApplication.class,
        properties = "spring.datasource.url=jdbc:h2:mem:auto-ut-endpoint;DB_CLOSE_DELAY=-1"
)
@AutoConfigureMockMvc
class AutoUtEndpointTest {
    @Autowired
    MockMvc mvc;
    @TempDir
    Path temporary;

    @Test
    void 可以在网页中浏览本机工作目录() throws Exception {
        Files.createDirectory(temporary.resolve("项目工作区"));

        mvc.perform(get("/api/auto-ut/workspace-directories").param("path", temporary.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.current").value(temporary.toString()))
                .andExpect(jsonPath("$.writable").value(true))
                .andExpect(jsonPath("$.directories[0].name").value("项目工作区"))
                .andExpect(jsonPath("$.directories[0].path").value(temporary.resolve("项目工作区").toString()));
    }

    @Test
    void 可以扫描报告并持久化未配置仓库任务() throws Exception {
        MockMultipartFile report = report("unknown");

        mvc.perform(multipart("/api/auto-ut/scan")
                        .file(report)
                        .param("username", "w00789509")
                        .param("ticket", "DTS1234")
                        .param("baseBranch", "develop"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].repository").value("unknown"))
                .andExpect(jsonPath("$[0].baseBranch").value("develop"))
                .andExpect(jsonPath("$[0].configured").value(false));

        mvc.perform(multipart("/api/auto-ut/tasks")
                        .file(report("unknown"))
                        .param("username", "w00789509")
                        .param("ticket", "DTS1234")
                        .param("baseBranch", "develop")
                        .param("workspaceRoot", Path.of(System.getProperty("java.io.tmpdir")).toString())
                        .param("executionMode", "MANUAL"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$[0].status").value("WAITING_REPOSITORY"))
                .andExpect(jsonPath("$[0].executionMode").value("MANUAL"))
                .andExpect(jsonPath("$[0].progress").value(0));

        mvc.perform(get("/api/auto-ut/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].repository").value("unknown"));
    }

    @Test
    void 可以保存查询和关闭每日定时执行() throws Exception {
        mvc.perform(multipart(HttpMethod.PUT, "/api/auto-ut/schedule")
                        .file(report("unknown"))
                        .param("username", "user1")
                        .param("ticket", "DTS1")
                        .param("baseBranch", "develop")
                        .param("workspaceRoot", temporary.toString())
                        .param("dailyTime", "23:59"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dailyTime").value("23:59"))
                .andExpect(jsonPath("$.baseBranch").value("develop"))
                .andExpect(jsonPath("$.reportFileName").value("report.csv"));

        mvc.perform(get("/api/auto-ut/schedule"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("user1"));

        mvc.perform(delete("/api/auto-ut/schedule"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auto-ut/schedule"))
                .andExpect(status().isNoContent());
    }

    private MockMultipartFile report(String repository) {
        String csv = "代码仓,语言,PL组,失败用例,行覆盖率,行覆盖率目标,分支覆盖率,分支覆盖率目标\n"
                + repository + ",Java,Access_智能监控组,1,80%,100%,70%,100%\n";
        return new MockMultipartFile("report", "report.csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8));
    }
}
