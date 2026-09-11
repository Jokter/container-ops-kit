package com.jokter.containerops.autout.infrastructure.config;

import com.jokter.containerops.autout.application.AutoUtRepositoryDefinition;
import com.jokter.containerops.autout.application.AutoUtSettings;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Component
@EnableConfigurationProperties(AutoUtConfigurationProperties.class)
public class ConfiguredAutoUtSettings implements AutoUtSettings {
    private static final Pattern REPOSITORY_NAME = Pattern.compile("[A-Za-z0-9._-]+");
    private final AutoUtConfigurationProperties properties;

    public ConfiguredAutoUtSettings(AutoUtConfigurationProperties properties) {
        this.properties = properties;
    }

    @Override public String language() { return properties.language(); }
    @Override public String plGroup() { return properties.plGroup(); }
    @Override public Path logDirectory() { return Path.of(properties.logDirectory()); }
    @Override public String piCommand() { return properties.repair().command(); }
    @Override public String piThinkingLevel() {
        String level = properties.repair().thinkingLevel();
        return level == null || level.isBlank() ? "medium" : level;
    }
    @Override public int piTimeoutSeconds() { return properties.repair().timeoutMinutes() * 60; }
    @Override public int maxAttempts() { return properties.repair().maxAttemptsPerRun(); }
    @Override public List<String> forbiddenMarkers() { return List.copyOf(properties.guard().forbiddenMarkers()); }
    @Override public String codeHubCommand() { return properties.scm().command(); }
    @Override public boolean createMergeRequest() { return properties.scm().createMergeRequest(); }
    @Override public String codeHubReviewers() { return valueOrEmpty(properties.scm().reviewers()); }
    @Override public String codeHubApprovers() { return valueOrEmpty(properties.scm().approvers()); }
    @Override public String codeHubAssignees() { return valueOrEmpty(properties.scm().assignees()); }

    @Override
    public Optional<AutoUtRepositoryDefinition> repository(String name) {
        String requested = name == null ? "" : name.trim();
        if (!REPOSITORY_NAME.matcher(requested).matches()) return Optional.empty();
        var configured = properties.repositories() == null
                ? Stream.<Map.Entry<String, AutoUtConfigurationProperties.Repository>>empty()
                : properties.repositories().entrySet().stream();
        var entry = configured
                .filter(item -> item.getKey().equalsIgnoreCase(requested))
                .findFirst();
        if (entry.isPresent()) {
            return definition(requested, entry.get().getValue(), entry.get().getValue().url());
        }
        var template = properties.repositoryTemplate();
        if (template == null || template.url() == null || !template.url().contains("{repository}")) {
            return Optional.empty();
        }
        return definition(requested, template, template.url().replace("{repository}", requested));
    }

    private Optional<AutoUtRepositoryDefinition> definition(
            String name, AutoUtConfigurationProperties.Repository value, String url
    ) {
        if (url == null || url.isBlank()) return Optional.empty();
        return Optional.of(new AutoUtRepositoryDefinition(
                name.toLowerCase(Locale.ROOT), url,
                List.copyOf(value.testCommand()), List.copyOf(value.verificationCommand()), value.coverageReport()
        ));
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
