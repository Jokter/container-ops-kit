package com.jokter.containerops.autout.application;

import org.springframework.stereotype.Service;

import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.StreamSupport;
import java.util.stream.Stream;

@Service
public class AutoUtWorkspaceDirectoryService {
    public DirectoryListing browse(String requestedPath) {
        if (requestedPath == null || requestedPath.isBlank()) {
            List<DirectoryEntry> roots = StreamSupport.stream(
                            FileSystems.getDefault().getRootDirectories().spliterator(), false)
                    .map(this::entry)
                    .toList();
            return new DirectoryListing("", "", false, roots);
        }
        Path current = Path.of(requestedPath).toAbsolutePath().normalize();
        if (!Files.isDirectory(current) || !Files.isReadable(current)) {
            throw new IllegalArgumentException("目录不存在或不可读取：" + current);
        }
        try (Stream<Path> children = Files.list(current)) {
            List<DirectoryEntry> directories = children
                    .filter(Files::isDirectory)
                    .sorted(Comparator.comparing(path -> name(path).toLowerCase()))
                    .map(this::entry)
                    .toList();
            Path parent = current.getParent();
            return new DirectoryListing(current.toString(), parent == null ? "" : parent.toString(),
                    Files.isWritable(current), directories);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法读取目录：" + current, exception);
        }
    }

    private DirectoryEntry entry(Path path) {
        return new DirectoryEntry(name(path), path.toAbsolutePath().normalize().toString(), Files.isWritable(path));
    }

    private String name(Path path) {
        Path fileName = path.getFileName();
        return fileName == null ? path.toString() : fileName.toString();
    }

    public record DirectoryListing(String current, String parent, boolean writable, List<DirectoryEntry> directories) {}

    public record DirectoryEntry(String name, String path, boolean writable) {}
}
