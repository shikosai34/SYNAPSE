CREATE TABLE `system_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
