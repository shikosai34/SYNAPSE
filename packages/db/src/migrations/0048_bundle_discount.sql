CREATE TABLE `bundle_discount` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'set_price' NOT NULL,
	`bundle_size` integer NOT NULL,
	`value` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bundle_discount_size_valid" CHECK("bundle_discount"."bundle_size" >= 2),
	CONSTRAINT "bundle_discount_kind_valid" CHECK("bundle_discount"."kind" IN ('set_price', 'amount_off', 'free_cheapest', 'percent_off')),
	CONSTRAINT "bundle_discount_value_valid" CHECK(("bundle_discount"."kind" = 'set_price' AND "bundle_discount"."value" >= 0)
      OR ("bundle_discount"."kind" = 'amount_off' AND "bundle_discount"."value" > 0)
      OR ("bundle_discount"."kind" = 'free_cheapest' AND "bundle_discount"."value" = 0)
      OR ("bundle_discount"."kind" = 'percent_off' AND "bundle_discount"."value" BETWEEN 1 AND 100)),
	CONSTRAINT "bundle_discount_status_valid" CHECK("bundle_discount"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX `bundle_discount_circle_status_idx` ON `bundle_discount` (`circle_id`,`status`);--> statement-breakpoint
CREATE TABLE `bundle_discount_menu` (
	`bundle_id` text NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle_discount`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bundle_discount_menu_unique` ON `bundle_discount_menu` (`bundle_id`,`menu_id`);--> statement-breakpoint
CREATE INDEX `bundle_discount_menu_menu_idx` ON `bundle_discount_menu` (`menu_id`);--> statement-breakpoint
CREATE TABLE `order_bundle_discount` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`sets` integer NOT NULL,
	`discount_applied` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bundle_id`) REFERENCES `bundle_discount`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_bundle_discount_unique` ON `order_bundle_discount` (`order_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `order_bundle_discount_bundle_idx` ON `order_bundle_discount` (`bundle_id`);