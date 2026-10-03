DROP INDEX `orders_order_number_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_circle_order_number_unique` ON `orders` (`circle_id`,`order_number`);