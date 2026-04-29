CREATE TABLE `follower_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`follower_count` integer NOT NULL,
	`following_count` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_follower_snapshots_account_day` ON `follower_snapshots` (`workspace_id`,`social_account_id`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_follower_snapshots_workspace_account` ON `follower_snapshots` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE INDEX `idx_follower_snapshots_date` ON `follower_snapshots` (`workspace_id`,`snapshot_date`);
