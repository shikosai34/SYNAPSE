CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `circle` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon_image_path` text,
	`background_image_path` text,
	`mods` text DEFAULT '{}' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`stamp_secret` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `circle_eventId_idx` ON `circle` (`event_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_name` text NOT NULL,
	`description` text,
	`start_date` integer,
	`end_date` integer,
	`logo_url` text,
	`font_family` text DEFAULT 'mono',
	`custom_font_url` text,
	`primary_color` text DEFAULT '#000000',
	`primary_text_color` text DEFAULT '#FFFFFF',
	`accent_color` text DEFAULT '#0000FF',
	`accent_text_color` text DEFAULT '#FFFFFF',
	`background_color` text DEFAULT '#FFFFFF',
	`text_color` text DEFAULT '#000000',
	`deleted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`circle_id` text,
	`event_id` text,
	`role` text NOT NULL,
	`max_uses` integer DEFAULT 1,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`target_email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_token_unique` ON `invite_token` (`token`);--> statement-breakpoint
CREATE INDEX `invite_token_token_idx` ON `invite_token` (`token`);--> statement-breakpoint
CREATE INDEX `invite_token_circleId_idx` ON `invite_token` (`circle_id`);--> statement-breakpoint
CREATE INDEX `invite_token_eventId_idx` ON `invite_token` (`event_id`);--> statement-breakpoint
CREATE TABLE `membership` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`user_name` text NOT NULL,
	`circle_id` text,
	`event_id` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`invited_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_userEmail_idx` ON `membership` (`user_email`);--> statement-breakpoint
CREATE INDEX `membership_circleId_idx` ON `membership` (`circle_id`);--> statement-breakpoint
CREATE INDEX `membership_eventId_idx` ON `membership` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_circle_unique` ON `membership` (`user_email`,`circle_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_user_event_unique` ON `membership` (`user_email`,`event_id`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`name` text NOT NULL,
	`shift_start` integer,
	`shift_end` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_circleId_idx` ON `staff` (`circle_id`);--> statement-breakpoint
CREATE TABLE `menu` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`image_path` text NOT NULL,
	`description` text,
	`additional_info` text,
	`sold_out` integer DEFAULT false NOT NULL,
	`stock_quantity` integer DEFAULT 0 NOT NULL,
	`default_topping_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_circleId_idx` ON `menu` (`circle_id`);--> statement-breakpoint
CREATE TABLE `menu_topping` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`topping_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topping_id`) REFERENCES `topping`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_topping_menuId_idx` ON `menu_topping` (`menu_id`);--> statement-breakpoint
CREATE INDEX `menu_topping_toppingId_idx` ON `menu_topping` (`topping_id`);--> statement-breakpoint
CREATE TABLE `topping` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`description` text,
	`image_path` text,
	`sold_out` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topping_circleId_idx` ON `topping` (`circle_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`circle_id` text NOT NULL,
	`order_number` text NOT NULL,
	`people_count` integer NOT NULL,
	`total_price` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`estimated_time` integer,
	`cashier_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `order_circleId_idx` ON `orders` (`circle_id`);--> statement-breakpoint
CREATE INDEX `order_orderNumber_idx` ON `orders` (`order_number`);--> statement-breakpoint
CREATE TABLE `order_item` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`menu_name` text NOT NULL,
	`menu_price` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_item_orderId_idx` ON `order_item` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_item_menuId_idx` ON `order_item` (`menu_id`);--> statement-breakpoint
CREATE TABLE `order_item_topping` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`topping_id` text NOT NULL,
	`topping_name` text NOT NULL,
	`topping_price` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topping_id`) REFERENCES `topping`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_item_topping_orderItemId_idx` ON `order_item_topping` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_item_topping_toppingId_idx` ON `order_item_topping` (`topping_id`);--> statement-breakpoint
CREATE TABLE `pre_order` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`circle_id` text NOT NULL,
	`total_price` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pre_order_userId_idx` ON `pre_order` (`user_id`);--> statement-breakpoint
CREATE INDEX `pre_order_circleId_idx` ON `pre_order` (`circle_id`);--> statement-breakpoint
CREATE INDEX `pre_order_status_idx` ON `pre_order` (`status`);--> statement-breakpoint
CREATE TABLE `pre_order_item` (
	`id` text PRIMARY KEY NOT NULL,
	`pre_order_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`pre_order_id`) REFERENCES `pre_order`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pre_order_item_preOrderId_idx` ON `pre_order_item` (`pre_order_id`);--> statement-breakpoint
CREATE TABLE `circle_visit` (
	`id` text PRIMARY KEY NOT NULL,
	`event_user_id` text NOT NULL,
	`circle_id` text NOT NULL,
	`staff_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `circle_visit_user_idx` ON `circle_visit` (`event_user_id`);--> statement-breakpoint
CREATE INDEX `circle_visit_circle_idx` ON `circle_visit` (`circle_id`);--> statement-breakpoint
CREATE INDEX `circle_visit_user_circle_idx` ON `circle_visit` (`event_user_id`,`circle_id`);--> statement-breakpoint
CREATE TABLE `event_user` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`display_id` integer NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`nickname` text,
	`birthday` text,
	`onboarded_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_user_eventId_idx` ON `event_user` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_user_event_display_unique` ON `event_user` (`event_id`,`display_id`);--> statement-breakpoint
CREATE TABLE `numbered_ticket` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`event_user_id` text NOT NULL,
	`slot_start` integer,
	`slot_label` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`issued_by_staff_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `numbered_ticket_circle_idx` ON `numbered_ticket` (`circle_id`);--> statement-breakpoint
CREATE INDEX `numbered_ticket_user_idx` ON `numbered_ticket` (`event_user_id`);--> statement-breakpoint
CREATE INDEX `numbered_ticket_status_idx` ON `numbered_ticket` (`status`);--> statement-breakpoint
CREATE TABLE `review` (
	`id` text PRIMARY KEY NOT NULL,
	`event_user_id` text NOT NULL,
	`circle_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_circle_idx` ON `review` (`circle_id`);--> statement-breakpoint
CREATE INDEX `review_user_idx` ON `review` (`event_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_user_circle_unique` ON `review` (`event_user_id`,`circle_id`);--> statement-breakpoint
CREATE TABLE `reward_redemption` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_redemption_user_id_unique` ON `reward_redemption` (`user_id`);--> statement-breakpoint
CREATE INDEX `reward_redemption_userId_idx` ON `reward_redemption` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_stamp` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`circle_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circle`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_stamp_userId_idx` ON `user_stamp` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_stamp_circleId_idx` ON `user_stamp` (`circle_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_stamp_user_circle_unique` ON `user_stamp` (`user_id`,`circle_id`);--> statement-breakpoint
CREATE TABLE `wristband` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`assigned_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deactivated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wristband_userId_idx` ON `wristband` (`user_id`);--> statement-breakpoint
CREATE INDEX `wristband_status_idx` ON `wristband` (`status`);--> statement-breakpoint
CREATE TABLE `lottery` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`draw_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lottery_event_idx` ON `lottery` (`event_id`);--> statement-breakpoint
CREATE TABLE `lottery_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`lottery_id` text NOT NULL,
	`event_user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lottery_id`) REFERENCES `lottery`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lottery_entry_lottery_idx` ON `lottery_entry` (`lottery_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lottery_entry_lottery_user_unique` ON `lottery_entry` (`lottery_id`,`event_user_id`);--> statement-breakpoint
CREATE TABLE `lottery_prize` (
	`id` text PRIMARY KEY NOT NULL,
	`lottery_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`lottery_id`) REFERENCES `lottery`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lottery_prize_lottery_idx` ON `lottery_prize` (`lottery_id`);--> statement-breakpoint
CREATE TABLE `lottery_winner` (
	`id` text PRIMARY KEY NOT NULL,
	`lottery_id` text NOT NULL,
	`prize_id` text NOT NULL,
	`event_user_id` text NOT NULL,
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lottery_id`) REFERENCES `lottery`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prize_id`) REFERENCES `lottery_prize`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_user_id`) REFERENCES `event_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lottery_winner_lottery_idx` ON `lottery_winner` (`lottery_id`);--> statement-breakpoint
CREATE INDEX `lottery_winner_user_idx` ON `lottery_winner` (`event_user_id`);--> statement-breakpoint
CREATE TABLE `announcement` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcement_published_idx` ON `announcement` (`published`);--> statement-breakpoint
CREATE TABLE `auth_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`first_failed_at` integer NOT NULL,
	`last_failed_at` integer NOT NULL,
	`locked_until` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_attempt_key_unique` ON `auth_attempt` (`key`);--> statement-breakpoint
CREATE INDEX `auth_attempt_locked_until_idx` ON `auth_attempt` (`locked_until`);--> statement-breakpoint
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
CREATE TABLE `system_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
