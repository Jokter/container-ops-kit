package com.jokter.containerops.environment.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

interface SpringDataReleaseVersionRepository extends JpaRepository<ReleaseVersionJpaEntity,Long>{
 List<ReleaseVersionJpaEntity> findAllByOrderBySortOrderAsc();
}