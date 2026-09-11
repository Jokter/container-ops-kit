create table auto_ut_repository_mapping (
    repository varchar(200) primary key,
    url varchar(2000) not null,
    updated_at timestamp with time zone not null
);
