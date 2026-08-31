package com.jokter.containerops.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "release_version")
public class ReleaseVersion {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, unique = true) private String code;
    @Column(nullable = false) private String name;
    @Column(name = "sort_order", nullable = false) private Integer sortOrder;
    protected ReleaseVersion() {}
    public Long getId(){return id;}
    public String getCode(){return code;}
    public String getName(){return name;}
    public Integer getSortOrder(){return sortOrder;}
}