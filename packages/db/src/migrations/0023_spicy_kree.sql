CREATE TABLE `wristband_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source` text NOT NULL,
	`prefix` text,
	`suffix_length` integer,
	`total_count` integer NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wristband_batch_event_created_idx` ON `wristband_batch` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wristband_batch_chunk` (
	`batch_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`urls_json` text NOT NULL,
	PRIMARY KEY(`batch_id`, `chunk_index`),
	FOREIGN KEY (`batch_id`) REFERENCES `wristband_batch`(`id`) ON UPDATE no action ON DELETE cascade
);
