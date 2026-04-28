CREATE TABLE `followers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_user_id` text NOT NULL,
	`display_name` text,
	`username` text,
	`is_following` integer DEFAULT false NOT NULL,
	`is_followed` integer DEFAULT false NOT NULL,
	`unfollowed_at` integer,
	`metadata` text,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_followers_account_external_user` ON `followers` (`social_account_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `idx_followers_workspace_account` ON `followers` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE INDEX `idx_followers_workspace_username` ON `followers` (`workspace_id`,`username`);
