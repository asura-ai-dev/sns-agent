CREATE TABLE `engagement_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text,
	`action_type` text NOT NULL,
	`target_post_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`external_action_id` text,
	`status` text NOT NULL,
	`metadata` text,
	`performed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_actions_dedupe` ON `engagement_actions` (`workspace_id`,`social_account_id`,`action_type`,`target_post_id`);
--> statement-breakpoint
CREATE INDEX `idx_engagement_actions_thread` ON `engagement_actions` (`thread_id`);
