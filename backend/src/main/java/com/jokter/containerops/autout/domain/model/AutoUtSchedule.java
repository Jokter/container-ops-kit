package com.jokter.containerops.autout.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

public final class AutoUtSchedule {
    public static final String ID = "daily";
    private final String reportFileName;
    private final byte[] report;
    private final String username;
    private final String ticket;
    private final String baseBranch;
    private final String workspaceRoot;
    private final LocalTime dailyTime;
    private LocalDate lastTriggeredOn;
    private Instant updatedAt;

    public AutoUtSchedule(
            String reportFileName, byte[] report, String username, String ticket, String baseBranch,
            String workspaceRoot, LocalTime dailyTime
    ) {
        this(reportFileName, report, username, ticket, baseBranch, workspaceRoot, dailyTime, null, Instant.now());
    }

    public static AutoUtSchedule restore(
            String reportFileName, byte[] report, String username, String ticket, String baseBranch,
            String workspaceRoot, LocalTime dailyTime, LocalDate lastTriggeredOn, Instant updatedAt
    ) {
        return new AutoUtSchedule(reportFileName, report, username, ticket, baseBranch, workspaceRoot,
                dailyTime, lastTriggeredOn, updatedAt);
    }

    private AutoUtSchedule(
            String reportFileName, byte[] report, String username, String ticket, String baseBranch,
            String workspaceRoot, LocalTime dailyTime, LocalDate lastTriggeredOn, Instant updatedAt
    ) {
        this.reportFileName = reportFileName;
        this.report = report.clone();
        this.username = username;
        this.ticket = ticket;
        this.baseBranch = baseBranch;
        this.workspaceRoot = workspaceRoot;
        this.dailyTime = dailyTime;
        this.lastTriggeredOn = lastTriggeredOn;
        this.updatedAt = updatedAt;
    }

    public boolean isDue(ZonedDateTime now) {
        return !now.toLocalTime().isBefore(dailyTime) && !now.toLocalDate().equals(lastTriggeredOn);
    }

    public void markTriggered(ZonedDateTime now) {
        lastTriggeredOn = now.toLocalDate();
        updatedAt = Instant.now();
    }

    public String reportFileName() { return reportFileName; }
    public byte[] report() { return report.clone(); }
    public String username() { return username; }
    public String ticket() { return ticket; }
    public String baseBranch() { return baseBranch; }
    public String workspaceRoot() { return workspaceRoot; }
    public LocalTime dailyTime() { return dailyTime; }
    public LocalDate lastTriggeredOn() { return lastTriggeredOn; }
    public Instant updatedAt() { return updatedAt; }
}
