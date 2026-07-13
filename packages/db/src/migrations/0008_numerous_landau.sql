ALTER TABLE `event_user` ADD `favorite_date` text;
--> statement-breakpoint
UPDATE `event_user` SET `favorite_date` = `birthday`;