package com.jokter.containerops.deployment.domain.service;

import java.util.Map;

public record ChartSource(String values, String chart, String globalBlock, Map<String, String> templates) {
}
