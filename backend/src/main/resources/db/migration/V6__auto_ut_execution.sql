alter table auto_ut_task add column workspace_root varchar(2000) not null default '';
alter table auto_ut_task add column execution_mode varchar(32) not null default 'MANUAL';
alter table auto_ut_task add column next_stage varchar(32) not null default 'PREPARE';
alter table auto_ut_task add column progress integer not null default 0;
update auto_ut_task set next_stage = 'DONE', progress = 100 where status = 'RESOLVED';
