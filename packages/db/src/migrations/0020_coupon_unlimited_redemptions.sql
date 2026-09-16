PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_coupon` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`passphrase` text NOT NULL,
	`kind` text DEFAULT 'menu_discount' NOT NULL,
	`discount_amount` integer,
	`free_units` integer,
	`max_redemptions` integer,
	`redeemed_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_coupon`("id", "circle_id", "title", "slug", "passphrase", "kind", "discount_amount", "free_units", "max_redemptions", "redeemed_count", "expires_at", "status", "created_at", "updated_at") SELECT "id", "circle_id", "title", "slug", "passphrase", "kind", "discount_amount", "free_units", "max_redemptions", "redeemed_count", "expires_at", "status", "created_at", "updated_at" FROM `coupon`;--> statement-breakpoint
DROP TABLE `coupon`;--> statement-breakpoint
ALTER TABLE `__new_coupon` RENAME TO `coupon`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_slug_unique` ON `coupon` (`slug`);--> statement-breakpoint
CREATE INDEX `coupon_circleId_idx` ON `coupon` (`circle_id`);--> statement-breakpoint
CREATE INDEX `coupon_slug_idx` ON `coupon` (`slug`);