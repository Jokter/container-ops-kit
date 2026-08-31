package com.jokter.containerops.environment.infrastructure.persistence;

import com.jokter.containerops.environment.domain.model.ReleaseVersion;
import jakarta.persistence.*;

@Entity
@Table(name="release_version")
public class ReleaseVersionJpaEntity {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false,unique=true) String code;
 @Column(nullable=false) String name;
 @Column(name="sort_order",nullable=false) Integer sortOrder;
 protected ReleaseVersionJpaEntity(){}
 ReleaseVersion toDomain(){return new ReleaseVersion(id,code,name,sortOrder);}
}