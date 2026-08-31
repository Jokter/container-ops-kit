package com.jokter.containerops.environment.infrastructure.persistence;

import com.jokter.containerops.environment.domain.model.Environment;
import com.jokter.containerops.environment.domain.repository.EnvironmentRepository;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
class JpaEnvironmentRepository implements EnvironmentRepository {
 private final SpringDataEnvironmentRepository environments;
 private final SpringDataReleaseVersionRepository versions;
 JpaEnvironmentRepository(SpringDataEnvironmentRepository environments,SpringDataReleaseVersionRepository versions){this.environments=environments;this.versions=versions;}
 public List<Environment> findAll(){return environments.findAllByOrderByUpdatedAtDesc().stream().map(EnvironmentJpaEntity::toDomain).toList();}
 public Optional<Environment> findById(Long id){return environments.findById(id).map(EnvironmentJpaEntity::toDomain);}
 public Environment save(Environment domain){
  EnvironmentJpaEntity entity=domain.getId()==null?new EnvironmentJpaEntity():environments.findById(domain.getId()).orElseThrow();
  ReleaseVersionJpaEntity version=versions.findById(domain.getReleaseVersion().id()).orElseThrow();
  entity.apply(domain,version);
  return environments.save(entity).toDomain();
 }
 public void delete(Environment environment){environments.deleteById(environment.getId());}
}