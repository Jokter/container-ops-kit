create table auto_ut_schedule (
    id varchar(32) primary key,
    report_file_name varchar(500) not null,
    report_content blob not null,
    username varchar(100) not null,
    ticket varchar(100) not null,
    workspace_root varchar(2000) not null,
    daily_time time not null,
    last_triggered_on date,
    updated_at timestamp with time zone not null
);
