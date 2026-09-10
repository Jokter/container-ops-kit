package com.jokter.containerops.autout.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

interface SpringDataAutoUtTaskRepository extends JpaRepository<AutoUtTaskJpaEntity, String> {
}
