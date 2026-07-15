CREATE TABLE `event_announcement` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`sender_email` text NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_announcement_eventId_idx` ON `event_announcement` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_announcement_createdAt_idx` ON `event_announcement` (`created_at`);