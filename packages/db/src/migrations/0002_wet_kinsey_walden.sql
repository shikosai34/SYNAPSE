CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'unread' NOT NULL,
	`circle_name` text,
	`event_name` text,
	`token` text,
	`role` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_user_idx` ON `notification` (`user_email`);--> statement-breakpoint
CREATE INDEX `notification_status_idx` ON `notification` (`status`);--> statement-breakpoint
ALTER TABLE `invite_token` ADD `target_email` text;