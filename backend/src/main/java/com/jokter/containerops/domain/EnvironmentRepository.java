package com.jokter.containerops.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface EnvironmentRepository extends JpaRepository<Environment, Long> {
    List<Environment> findAllByOrderByUpdatedAtDesc();
}