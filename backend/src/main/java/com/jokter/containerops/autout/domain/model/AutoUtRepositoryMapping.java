package com.jokter.containerops.autout.domain.model;

import java.time.Instant;

public record AutoUtRepositoryMapping(String repository, String url, Instant updatedAt) {
}
