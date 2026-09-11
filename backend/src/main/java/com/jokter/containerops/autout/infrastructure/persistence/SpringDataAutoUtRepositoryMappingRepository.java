package com.jokter.containerops.autout.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

interface SpringDataAutoUtRepositoryMappingRepository
        extends JpaRepository<AutoUtRepositoryMappingJpaEntity, String> {
}
