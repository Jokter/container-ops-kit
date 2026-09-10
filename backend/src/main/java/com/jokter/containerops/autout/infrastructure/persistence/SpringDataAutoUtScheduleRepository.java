package com.jokter.containerops.autout.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

interface SpringDataAutoUtScheduleRepository extends JpaRepository<AutoUtScheduleJpaEntity, String> {}
