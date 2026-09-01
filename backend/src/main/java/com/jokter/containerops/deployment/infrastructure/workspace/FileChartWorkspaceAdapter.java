package com.jokter.containerops.deployment.infrastructure.workspace;

import com.jokter.containerops.deployment.application.ChartWorkspacePort;
import com.jokter.containerops.deployment.domain.model.PreparedService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
class FileChartWorkspaceAdapter implements ChartWorkspacePort {
    private final Path root;

    FileChartWorkspaceAdapter(@Value("${deployment.workspace:./data/deployment-preparations}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    @Override
    public void write(String preparationId, PreparedService service) {
        Path serviceRoot = resolve(preparationId, service.service());
        try {
            Files.createDirectories(serviceRoot.resolve("templates"));
            Files.writeString(serviceRoot.resolve("values.yaml"), service.values(), StandardCharsets.UTF_8);
            Files.writeString(serviceRoot.resolve("Chart.yaml"), service.chart(), StandardCharsets.UTF_8);
            for (Map.Entry<String, String> template : service.templates().entrySet()) {
                Path target = serviceRoot.resolve("templates").resolve(template.getKey()).normalize();
                if (!target.startsWith(serviceRoot.resolve("templates"))) {
                    throw new IllegalArgumentException("模板文件名格式不正确");
                }
                Files.writeString(target, template.getValue(), StandardCharsets.UTF_8);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Chart 本地生成失败", exception);
        }
    }

    @Override
    public Map<String, byte[]> files(String preparationId, String service) {
        Path serviceRoot = resolve(preparationId, service);
        Map<String, byte[]> result = new LinkedHashMap<>();
        try (var files = Files.walk(serviceRoot)) {
            files.filter(Files::isRegularFile).forEach(file -> {
                try {
                    result.put(serviceRoot.relativize(file).toString().replace('\\', '/'), Files.readAllBytes(file));
                } catch (IOException exception) {
                    throw new IllegalStateException("Chart 文件读取失败", exception);
                }
            });
            return result;
        } catch (IOException exception) {
            throw new IllegalStateException("Chart 工作目录读取失败", exception);
        }
    }

    private Path resolve(String preparationId, String service) {
        Path path = root.resolve(preparationId).resolve(service).normalize();
        if (!path.startsWith(root)) {
            throw new IllegalArgumentException("Chart 工作目录不正确");
        }
        return path;
    }
}
