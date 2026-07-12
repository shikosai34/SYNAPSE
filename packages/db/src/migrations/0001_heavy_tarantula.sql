ALTER TABLE `passkey` ADD `aaguid` text;--> statement-breakpoint
ALTER TABLE `event` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `billing_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `max_circles` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `event` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `event` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `event` ADD `activated_at` integer;--> statement-breakpoint
ALTER TABLE `event` ADD `suspended_at` integer;