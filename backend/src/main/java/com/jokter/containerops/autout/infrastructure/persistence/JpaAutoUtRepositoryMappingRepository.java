package com.jokter.containerops.autout.infrastructure.persistence;

import com.jokter.containerops.autout.application.AutoUtRepositoryMappingRepository;
import com.jokter.containerops.autout.domain.model.AutoUtRepositoryMapping;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class JpaAutoUtRepositoryMappingRepository implements AutoUtRepositoryMappingRepository {
    private final SpringDataAutoUtRepositoryMappingRepository repository;

    public JpaAutoUtRepositoryMappingRepository(SpringDataAutoUtRepositoryMappingRepository repository) {
        this.repository = repository;
    }

    @Override
    public Optional<AutoUtRepositoryMapping> find(String name) {
        return repository.findById(name).map(this::toDomain);
    }

    @Override
    public AutoUtRepositoryMapping save(AutoUtRepositoryMapping mapping) {
        AutoUtRepositoryMappingJpaEntity entity = new AutoUtRepositoryMappingJpaEntity();
        entity.repository = mapping.repository();
        entity.url = mapping.url();
        entity.updatedAt = mapping.updatedAt();
        return toDomain(repository.save(entity));
    }

    private AutoUtRepositoryMapping toDomain(AutoUtRepositoryMappingJpaEntity entity) {
        return new AutoUtRepositoryMapping(entity.repository, entity.url, entity.updatedAt);
    }
}
