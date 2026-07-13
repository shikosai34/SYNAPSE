CREATE TABLE `pre_order_item_topping` (
	`id` text PRIMARY KEY NOT NULL,
	`pre_order_item_id` text NOT NULL,
	`topping_id` text NOT NULL,
	`topping_name` text NOT NULL,
	`topping_price` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`pre_order_item_id`) REFERENCES `pre_order_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topping_id`) REFERENCES `topping`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pre_order_item_topping_preOrderItemId_idx` ON `pre_order_item_topping` (`pre_order_item_id`);--> statement-breakpoint
CREATE INDEX `pre_order_item_topping_toppingId_idx` ON `pre_order_item_topping` (`topping_id`);