package com.jokter.containerops.autout.infrastructure.config;

import com.jokter.containerops.autout.application.AutoUtRepositoryDefinition;
import com.jokter.containerops.autout.application.AutoUtSettings;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Component
@EnableConfigurationProperties(AutoUtConfigurationProperties.class)
public class ConfiguredAutoUtSettings implements AutoUtSettings {
    private final AutoUtConfigurationProperties properties;

    public ConfiguredAutoUtSettings(AutoUtConfigurationProperties properties) {
        this.properties = properties;
    }

    @Override public String language() { return properties.language(); }
    @Override public String plGroup() { return properties.plGroup(); }
    @Override public Path logDirectory() { return Path.of(properties.logDirectory()); }
    @Override public String piCommand() { return properties.repair().command(); }
    @Override public int piTimeoutSeconds() { return properties.repair().timeoutMinutes() * 60; }
    @Override public int maxAttempts() { return properties.repair().maxAttemptsPerRun(); }
    @Override public List<String> forbiddenMarkers() { return List.copyOf(properties.guard().forbiddenMarkers()); }
    @Override public String ghCommand() { return properties.scm().command(); }
    @Override public boolean createPullRequest() { return properties.scm().createPullRequest(); }

    @Override
    public Optional<AutoUtRepositoryDefinition> repository(String name) {
        var entry = properties.repositories().entrySet().stream()
                .filter(item -> item.getKey().equalsIgnoreCase(name))
                .findFirst();
        if (entry.isEmpty()) return Optional.empty();
        var value = entry.get().getValue();
        return Optional.of(new AutoUtRepositoryDefinition(
                entry.get().getKey().toLowerCase(Locale.ROOT), value.url(),
                List.copyOf(value.testCommand()), List.copyOf(value.verificationCommand()), value.coverageReport()
        ));
    }
}
