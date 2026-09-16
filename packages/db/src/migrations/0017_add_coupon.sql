CREATE TABLE `coupon` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`passphrase` text NOT NULL,
	`discount_amount` integer NOT NULL,
	`max_redemptions` integer NOT NULL,
	`redeemed_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_slug_unique` ON `coupon` (`slug`);--> statement-breakpoint
CREATE INDEX `coupon_circleId_idx` ON `coupon` (`circle_id`);--> statement-breakpoint
CREATE INDEX `coupon_slug_idx` ON `coupon` (`slug`);--> statement-breakpoint
CREATE TABLE `coupon_redemption` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`event_user_id` text NOT NULL,
	`pre_order_id` text NOT NULL,
	`discount_applied` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupon`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pre_order_id`) REFERENCES `pre_order`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coupon_redemption_couponId_idx` ON `coupon_redemption` (`coupon_id`);--> statement-breakpoint
CREATE INDEX `coupon_redemption_eventUserId_idx` ON `coupon_redemption` (`event_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_redemption_coupon_user_unique` ON `coupon_redemption` (`coupon_id`,`event_user_id`);--> statement-breakpoint
ALTER TABLE `pre_order` ADD `coupon_id` text REFERENCES coupon(id);--> statement-breakpoint
ALTER TABLE `pre_order` ADD `discount_amount` integer;