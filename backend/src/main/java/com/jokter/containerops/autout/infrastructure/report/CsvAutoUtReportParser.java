package com.jokter.containerops.autout.infrastructure.report;

import com.jokter.containerops.autout.application.AutoUtReportParser;
import com.jokter.containerops.autout.domain.model.AutoUtReportItem;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class CsvAutoUtReportParser implements AutoUtReportParser {
    private static final Set<String> REQUIRED_COLUMNS = Set.of(
            "代码仓", "语言", "PL组", "失败用例", "行覆盖率", "行覆盖率目标", "分支覆盖率", "分支覆盖率目标"
    );

    @Override
    public List<AutoUtReportItem> parse(byte[] report, String language, String plGroup) {
        if (report == null || report.length == 0) {
            throw new IllegalArgumentException("CSV 报告不能为空");
        }
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setIgnoreEmptyLines(true)
                .setTrim(true)
                .get();
        try (var reader = new InputStreamReader(new ByteArrayInputStream(removeBom(report)), StandardCharsets.UTF_8);
             CSVParser parser = format.parse(reader)) {
            var missing = REQUIRED_COLUMNS.stream().filter(column -> !parser.getHeaderMap().containsKey(column)).sorted().toList();
            if (!missing.isEmpty()) {
                throw new IllegalArgumentException("CSV 缺少必要列：" + String.join("、", missing));
            }
            Map<String, AutoUtReportItem> items = new LinkedHashMap<>();
            for (CSVRecord row : parser) {
                AutoUtReportItem item = item(row);
                if (!item.repository().isBlank()
                        && item.language().equalsIgnoreCase(language)
                        && item.plGroup().equals(plGroup)
                        && item.needsRepair()) {
                    items.put(item.repository().toLowerCase(), item);
                }
            }
            return List.copyOf(items.values());
        } catch (IOException | NumberFormatException exception) {
            throw new IllegalArgumentException("CSV 报告格式无效：" + exception.getMessage(), exception);
        }
    }

    private AutoUtReportItem item(CSVRecord row) {
        return new AutoUtReportItem(
                row.get("代码仓"),
                row.get("语言"),
                row.get("PL组"),
                integer(row.get("失败用例")),
                percentage(row.get("行覆盖率")),
                percentage(row.get("行覆盖率目标")),
                percentage(row.get("分支覆盖率")),
                percentage(row.get("分支覆盖率目标"))
        );
    }

    private int integer(String value) {
        String text = value == null || value.isBlank() ? "0" : value.trim();
        return (int) Double.parseDouble(text);
    }

    private double percentage(String value) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) return 0;
        return text.endsWith("%")
                ? Double.parseDouble(text.substring(0, text.length() - 1)) / 100
                : Double.parseDouble(text);
    }

    private byte[] removeBom(byte[] report) {
        if (report.length >= 3 && report[0] == (byte) 0xEF && report[1] == (byte) 0xBB && report[2] == (byte) 0xBF) {
            return java.util.Arrays.copyOfRange(report, 3, report.length);
        }
        return report;
    }
}
