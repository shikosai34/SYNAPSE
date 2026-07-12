CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`as_role` text,
	`event_id` text,
	`circle_id` text,
	`method` text,
	`path` text,
	`summary` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_email`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `impersonation_session` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`role` text NOT NULL,
	`event_id` text,
	`circle_id` text,
	`label` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `impersonation_session_session_unique` ON `impersonation_session` (`session_id`);--> statement-breakpoint
CREATE TABLE `sudo_session` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_email` text NOT NULL,
	`method` text DEFAULT 'passkey' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sudo_session_session_unique` ON `sudo_session` (`session_id`);