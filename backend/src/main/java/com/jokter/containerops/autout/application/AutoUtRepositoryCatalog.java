package com.jokter.containerops.autout.application;

import com.jokter.containerops.autout.domain.model.AutoUtRepositoryMapping;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class AutoUtRepositoryCatalog {
    private static final Pattern REPOSITORY_NAME = Pattern.compile("[A-Za-z0-9._-]+");
    private final AutoUtSettings defaults;
    private final AutoUtRepositoryMappingRepository mappings;

    public AutoUtRepositoryCatalog(AutoUtSettings defaults, AutoUtRepositoryMappingRepository mappings) {
        this.defaults = defaults;
        this.mappings = mappings;
    }

    public Optional<ResolvedRepository> resolve(String repository) {
        String name = validName(repository);
        Optional<AutoUtRepositoryDefinition> defaultsForRepository = defaults.repository(name);
        if (defaultsForRepository.isEmpty()) return Optional.empty();
        AutoUtRepositoryDefinition definition = defaultsForRepository.get();
        return mappings.find(key(name))
                .map(mapping -> new ResolvedRepository(withUrl(definition, mapping.url()), true, mapping.updatedAt()))
                .or(() -> Optional.of(new ResolvedRepository(definition, false, null)));
    }

    public ResolvedRepository save(String repository, String url) {
        String name = validName(repository);
        AutoUtRepositoryDefinition defaultsForRepository = defaults.repository(name)
                .orElseThrow(() -> new IllegalArgumentException("无法为代码仓生成默认配置：" + name));
        String normalizedUrl = validCodeHubUrl(url);
        AutoUtRepositoryMapping saved = mappings.save(
                new AutoUtRepositoryMapping(key(name), normalizedUrl, Instant.now()));
        return new ResolvedRepository(withUrl(defaultsForRepository, saved.url()), true, saved.updatedAt());
    }

    private AutoUtRepositoryDefinition withUrl(AutoUtRepositoryDefinition definition, String url) {
        return new AutoUtRepositoryDefinition(
                definition.name(), url, definition.testCommand(),
                definition.verificationCommand(), definition.coverageReport());
    }

    private String validName(String repository) {
        String value = repository == null ? "" : repository.trim();
        if (!REPOSITORY_NAME.matcher(value).matches()) {
            throw new IllegalArgumentException("代码仓名称格式无效");
        }
        return value;
    }

    private String validCodeHubUrl(String url) {
        String value = url == null ? "" : url.trim();
        if (value.length() > 2000) throw new IllegalArgumentException("CodeHub 仓库地址过长");
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            boolean supportedScheme = "ssh".equalsIgnoreCase(scheme)
                    || "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
            if (!supportedScheme || host == null || !host.toLowerCase(Locale.ROOT).endsWith(".codehub.huawei.com")
                    || uri.getPath() == null || !uri.getPath().endsWith(".git")) {
                throw new IllegalArgumentException("请输入有效的 CodeHub clone URL");
            }
            return value;
        } catch (IllegalArgumentException exception) {
            if (exception.getMessage() != null && exception.getMessage().startsWith("请输入")) throw exception;
            throw new IllegalArgumentException("请输入有效的 CodeHub clone URL");
        }
    }

    private String key(String repository) {
        return repository.toLowerCase(Locale.ROOT);
    }

    public record ResolvedRepository(
            AutoUtRepositoryDefinition definition,
            boolean customized,
            Instant updatedAt
    ) {
    }
}
