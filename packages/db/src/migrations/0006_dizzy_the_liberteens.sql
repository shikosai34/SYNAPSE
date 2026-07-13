ALTER TABLE `event` ADD `payment_methods` text DEFAULT '["現金"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_method` text;