ALTER TABLE `menu` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu` ADD `topping_wizard_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `menu` ADD `topping_category_minimums` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `topping` ADD `category` text DEFAULT '' NOT NULL;