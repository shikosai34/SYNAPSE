CREATE TABLE `coupon_menu` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupon`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coupon_menu_couponId_idx` ON `coupon_menu` (`coupon_id`);--> statement-breakpoint
CREATE INDEX `coupon_menu_menuId_idx` ON `coupon_menu` (`menu_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_menu_coupon_menu_unique` ON `coupon_menu` (`coupon_id`,`menu_id`);