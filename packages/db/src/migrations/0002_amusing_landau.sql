ALTER TABLE `invite_token` ADD `code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_code_unique` ON `invite_token` (`code`);