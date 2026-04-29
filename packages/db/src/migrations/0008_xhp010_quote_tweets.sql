CREATE TABLE `quote_tweets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`source_tweet_id` text NOT NULL,
	`quote_tweet_id` text NOT NULL,
	`author_external_id` text NOT NULL,
	`author_username` text,
	`author_display_name` text,
	`author_profile_image_url` text,
	`author_verified` integer DEFAULT false NOT NULL,
	`content_text` text,
	`content_media` text,
	`quoted_at` integer,
	`metrics` text,
	`provider_metadata` text,
	`last_action_type` text,
	`last_action_external_id` text,
	`last_action_at` integer,
	`discovered_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quote_tweets_source_quote` ON `quote_tweets` (`workspace_id`,`social_account_id`,`source_tweet_id`,`quote_tweet_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_tweets_workspace_account` ON `quote_tweets` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE INDEX `idx_quote_tweets_source` ON `quote_tweets` (`workspace_id`,`source_tweet_id`);
