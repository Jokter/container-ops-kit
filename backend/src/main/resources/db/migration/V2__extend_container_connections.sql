alter table environment add column root_password varchar(512);
alter table environment rename column mae to business_plane_url;
alter table environment rename column mae_user to business_plane_user;
alter table environment rename column mae_password to business_plane_password;
alter table environment rename column osmu to management_plane_url;
alter table environment rename column osmu_user to management_plane_user;
alter table environment rename column osmu_password to management_plane_password;
