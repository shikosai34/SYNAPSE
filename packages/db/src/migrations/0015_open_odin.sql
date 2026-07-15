CREATE TABLE `contract_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT '銀行振込' NOT NULL,
	`paid_at` integer NOT NULL,
	`note` text,
	`recorded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contract_payment_eventId_idx` ON `contract_payment` (`event_id`);--> statement-breakpoint
ALTER TABLE `event` ADD `billing_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `next_billing_at` integer;--> statement-breakpoint
ALTER TABLE `event` ADD `contract_notes` text;