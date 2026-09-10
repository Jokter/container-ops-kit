package com.jokter.containerops.autout.application;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

public interface AutoUtSettings {
    String language();
    String plGroup();
    Path logDirectory();
    String piCommand();
    int piTimeoutSeconds();
    int maxAttempts();
    List<String> forbiddenMarkers();
    String ghCommand();
    boolean createPullRequest();
    Optional<AutoUtRepositoryDefinition> repository(String name);
}
