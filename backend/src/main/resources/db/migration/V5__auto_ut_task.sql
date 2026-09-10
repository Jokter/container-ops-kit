create table auto_ut_task (
    id varchar(36) primary key,
    repository varchar(200) not null,
    username varchar(100) not null,
    ticket varchar(100) not null,
    base_branch varchar(300) not null,
    repair_branch varchar(500) not null,
    reported_failed_tests integer not null,
    line_goal double precision not null,
    branch_goal double precision not null,
    status varchar(40) not null,
    attempts integer not null,
    message varchar(4000) not null,
    pull_request_url varchar(2000) not null,
    created_at timestamp with time zone not null,
    updated_at timestamp with time zone not null,
    history_json clob not null
);

create index idx_auto_ut_task_created_at on auto_ut_task(created_at);
