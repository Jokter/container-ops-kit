package com.jokter.containerops.environment.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

interface SpringDataEnvironmentRepository extends JpaRepository<EnvironmentJpaEntity,Long>{
 List<EnvironmentJpaEntity> findAllByOrderByUpdatedAtDesc();
}