CREATE TABLE `order_commit` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_commit_order_idx` ON `order_commit` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_sequence` (
	`scope` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_write_guard` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "order_write_guard_valid" CHECK("order_write_guard"."valid" = 1)
);
--> statement-breakpoint
DROP INDEX `orders_order_number_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_circle_order_number_unique` ON `orders` (`circle_id`,`order_number`);--> statement-breakpoint
ALTER TABLE `event` ADD `advanced_permissions` integer DEFAULT false NOT NULL;