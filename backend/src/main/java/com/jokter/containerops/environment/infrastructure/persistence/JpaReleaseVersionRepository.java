package com.jokter.containerops.environment.infrastructure.persistence;

import com.jokter.containerops.environment.domain.model.ReleaseVersion;
import com.jokter.containerops.environment.domain.repository.ReleaseVersionRepository;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
class JpaReleaseVersionRepository implements ReleaseVersionRepository {
 private final SpringDataReleaseVersionRepository repository;
 JpaReleaseVersionRepository(SpringDataReleaseVersionRepository repository){this.repository=repository;}
 public List<ReleaseVersion> findAll(){return repository.findAllByOrderBySortOrderAsc().stream().map(ReleaseVersionJpaEntity::toDomain).toList();}
 public Optional<ReleaseVersion> findById(Long id){return repository.findById(id).map(ReleaseVersionJpaEntity::toDomain);}
}