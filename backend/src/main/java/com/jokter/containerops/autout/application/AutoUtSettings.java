package com.jokter.containerops.autout.application;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

public interface AutoUtSettings {
    String language();
    String plGroup();
    Path logDirectory();
    String piCommand();
    default String piThinkingLevel() { return "medium"; }
    int piTimeoutSeconds();
    int maxAttempts();
    List<String> forbiddenMarkers();
    String codeHubCommand();
    boolean createMergeRequest();
    default String codeHubReviewers() { return ""; }
    default String codeHubApprovers() { return ""; }
    default String codeHubAssignees() { return ""; }
    Optional<AutoUtRepositoryDefinition> repository(String name);
}
