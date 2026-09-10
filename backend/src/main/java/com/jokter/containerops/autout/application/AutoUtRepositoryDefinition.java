package com.jokter.containerops.autout.application;

import java.util.List;

public record AutoUtRepositoryDefinition(
        String name,
        String url,
        List<String> testCommand,
        List<String> verificationCommand,
        String coverageReport
) {
}
