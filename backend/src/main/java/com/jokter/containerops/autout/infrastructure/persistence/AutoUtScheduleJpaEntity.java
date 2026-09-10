package com.jokter.containerops.autout.infrastructure.persistence;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;

@Entity
@Table(name = "auto_ut_schedule")
class AutoUtScheduleJpaEntity {
    @Id
    String id;
    String reportFileName;
    @Lob
    byte[] reportContent;
    String username;
    String ticket;
    String baseBranch;
    String workspaceRoot;
    LocalTime dailyTime;
    LocalDate lastTriggeredOn;
    Instant updatedAt;

    protected AutoUtScheduleJpaEntity() {}
}
