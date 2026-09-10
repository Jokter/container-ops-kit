package com.jokter.containerops.autout.infrastructure.report;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class CsvAutoUtReportParserTest {
    @Test
    void 只返回目标范围内需要修复的仓库() {
        String csv = "代码仓,语言,PL组,失败用例,行覆盖率,行覆盖率目标,分支覆盖率,分支覆盖率目标\n"
                + "coder,Java,Access_智能监控组,2,100%,100%,100%,100%\n"
                + "healthy,Java,Access_智能监控组,0,100%,100%,100%,100%\n"
                + "other,Python,Access_智能监控组,1,10%,80%,10%,70%\n";

        var items = new CsvAutoUtReportParser().parse(
                csv.getBytes(StandardCharsets.UTF_8),
                "Java",
                "Access_智能监控组"
        );

        assertThat(items).singleElement().satisfies(item -> {
            assertThat(item.repository()).isEqualTo("coder");
            assertThat(item.failedTests()).isEqualTo(2);
            assertThat(item.lineCoverage()).isEqualTo(1.0);
        });
    }

    @Test
    void 缺少必要列时拒绝报告() {
        byte[] csv = "代码仓,语言\ncoder,Java\n".getBytes(StandardCharsets.UTF_8);

        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                new CsvAutoUtReportParser().parse(csv, "Java", "Access_智能监控组"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("CSV 缺少必要列");
    }
}
