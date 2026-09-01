create table build_task (
  id varchar(64) primary key,
  mode varchar(16) not null,
  environment_id bigint not null,
  environment_name varchar(128) not null,
  module varchar(128) not null,
  baseline_cbb_branch varchar(255) not null,
  baseline_arch_branch varchar(255) not null,
  candidate_cbb_branch varchar(255),
  candidate_arch_branch varchar(255),
  workspace_root varchar(1000) not null,
  status varchar(16) not null,
  error varchar(2000),
  created_at timestamp not null,
  started_at timestamp,
  finished_at timestamp,
  completed_steps int not null,
  event_sequence bigint not null,
  steps_json clob not null,
  events_json clob not null
);

create index idx_build_task_created_at on build_task(created_at);
