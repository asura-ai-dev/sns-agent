-- Generated from packages/db/src/migrations/*.sql for Cloudflare D1.
-- Keep this file in sync with Drizzle SQLite migrations.

-- Source: 0000_cynical_dakota_north.sql
CREATE TABLE `agent_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`payload` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`reason` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`platform` text,
	`social_account_id` text,
	`input_summary` text,
	`result_summary` text,
	`estimated_cost_usd` real,
	`request_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_workspace_created` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_actor_created` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `budget_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_value` text,
	`period` text NOT NULL,
	`limit_amount_usd` real NOT NULL,
	`action_on_exceed` text DEFAULT 'warn' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversation_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_thread_id` text,
	`participant_name` text,
	`participant_external_id` text,
	`channel` text,
	`initiated_by` text,
	`last_message_at` integer,
	`provider_metadata` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `llm_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text,
	`action` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`temperature` real,
	`max_tokens` integer,
	`fallback_provider` text,
	`fallback_model` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`content_text` text,
	`content_media` text,
	`external_message_id` text,
	`author_external_id` text,
	`author_display_name` text,
	`sent_at` integer,
	`provider_metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`status` text NOT NULL,
	`content_text` text,
	`content_media` text,
	`provider_metadata` text,
	`platform_post_id` text,
	`validation_result` text,
	`idempotency_key` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_idempotency_key_unique` ON `posts` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_posts_workspace_status` ON `posts` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_posts_workspace_platform_created` ON `posts` (`workspace_id`,`platform`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`post_id` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text NOT NULL,
	`locked_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`last_error` text,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_jobs_status_scheduled` ON `scheduled_jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `skill_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`platform` text NOT NULL,
	`llm_provider` text NOT NULL,
	`manifest` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`external_account_id` text NOT NULL,
	`credentials_encrypted` text NOT NULL,
	`token_expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`capabilities` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`endpoint` text NOT NULL,
	`actor_id` text,
	`actor_type` text NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`success` integer NOT NULL,
	`estimated_cost_usd` real,
	`recorded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_workspace_platform_recorded` ON `usage_records` (`workspace_id`,`platform`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

-- Source: 0001_openai_codex_provider_credentials.sql
CREATE TABLE `llm_provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`expires_at` integer,
	`scopes` text,
	`subject` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_llm_provider_credentials_workspace_provider` ON `llm_provider_credentials` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_llm_provider_credentials_workspace_status` ON `llm_provider_credentials` (`workspace_id`,`status`);

-- Source: 0002_x_followers.sql
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

-- Source: 0003_follower_tags.sql
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_account_name` ON `tags` (`social_account_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_tags_workspace_account` ON `tags` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE TABLE `follower_tags` (
	`follower_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`follower_id`, `tag_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `followers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_follower_tags_tag` ON `follower_tags` (`tag_id`);

-- Source: 0004_engagement_gates.sql
CREATE TABLE `engagement_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`trigger_type` text DEFAULT 'reply' NOT NULL,
	`trigger_post_id` text,
	`conditions` text,
	`action_type` text NOT NULL,
	`action_text` text,
	`last_reply_since_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engagement_gates_workspace_account` ON `engagement_gates` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE INDEX `idx_engagement_gates_status_trigger` ON `engagement_gates` (`status`,`trigger_type`);--> statement-breakpoint
CREATE TABLE `engagement_gate_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`engagement_gate_id` text NOT NULL,
	`social_account_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`external_reply_id` text,
	`action_type` text NOT NULL,
	`status` text NOT NULL,
	`response_external_id` text,
	`metadata` text,
	`delivered_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engagement_gate_id`) REFERENCES `engagement_gates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_gate_deliveries_gate_user` ON `engagement_gate_deliveries` (`engagement_gate_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `idx_engagement_gate_deliveries_gate` ON `engagement_gate_deliveries` (`engagement_gate_id`);

-- Source: 0005_xhp006_engagement_gate_verify.sql
ALTER TABLE `engagement_gates` ADD `line_harness_url` text;
--> statement-breakpoint
ALTER TABLE `engagement_gates` ADD `line_harness_api_key_ref` text;
--> statement-breakpoint
ALTER TABLE `engagement_gates` ADD `line_harness_tag` text;
--> statement-breakpoint
ALTER TABLE `engagement_gates` ADD `line_harness_scenario` text;
--> statement-breakpoint
ALTER TABLE `engagement_gate_deliveries` ADD `delivery_token` text;
--> statement-breakpoint
ALTER TABLE `engagement_gate_deliveries` ADD `consumed_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_gate_deliveries_token` ON `engagement_gate_deliveries` (`delivery_token`);

-- Source: 0006_xhp020_stealth_controls.sql
ALTER TABLE `engagement_gates` ADD `stealth_config` text;
--> statement-breakpoint
ALTER TABLE `engagement_gates` ADD `delivery_backoff_until` integer;

-- Source: 0007_xhp008_engagement_actions.sql
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

-- Source: 0008_xhp010_quote_tweets.sql
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

-- Source: 0009_xhp013_follower_snapshots.sql
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

-- Source: 0010_xhp015_usage_dimensions.sql
ALTER TABLE `usage_records` ADD `gate_id` text;--> statement-breakpoint
ALTER TABLE `usage_records` ADD `feature` text;--> statement-breakpoint
ALTER TABLE `usage_records` ADD `metadata` text;--> statement-breakpoint
CREATE INDEX `idx_usage_records_workspace_endpoint_recorded` ON `usage_records` (`workspace_id`,`endpoint`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_workspace_gate_recorded` ON `usage_records` (`workspace_id`,`gate_id`,`recorded_at`);

-- Source: 0011_xhp014_step_sequences.sql
CREATE TABLE `step_sequences` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `social_account_id` text NOT NULL,
  `platform` text NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `stealth_config` text,
  `delivery_backoff_until` integer,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_step_sequences_workspace_account` ON `step_sequences` (`workspace_id`,`social_account_id`);--> statement-breakpoint
CREATE INDEX `idx_step_sequences_status` ON `step_sequences` (`status`);--> statement-breakpoint
CREATE TABLE `step_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `sequence_id` text NOT NULL,
  `step_index` integer NOT NULL,
  `delay_seconds` integer NOT NULL,
  `action_type` text NOT NULL,
  `content_text` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`sequence_id`) REFERENCES `step_sequences`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_step_messages_sequence_index` ON `step_messages` (`sequence_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `step_enrollments` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `sequence_id` text NOT NULL,
  `social_account_id` text NOT NULL,
  `external_user_id` text NOT NULL,
  `username` text,
  `external_thread_id` text,
  `reply_to_message_id` text,
  `status` text DEFAULT 'active' NOT NULL,
  `current_step_index` integer DEFAULT 0 NOT NULL,
  `next_step_at` integer,
  `last_delivered_at` integer,
  `completed_at` integer,
  `cancelled_at` integer,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`sequence_id`) REFERENCES `step_sequences`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_step_enrollments_sequence` ON `step_enrollments` (`sequence_id`);--> statement-breakpoint
CREATE INDEX `idx_step_enrollments_due` ON `step_enrollments` (`status`,`next_step_at`);--> statement-breakpoint
CREATE INDEX `idx_step_enrollments_account_delivered` ON `step_enrollments` (`social_account_id`,`last_delivered_at`);

-- Worker deployment schema marker.
CREATE TABLE IF NOT EXISTS `sns_agent_schema_version` (
	`version` text PRIMARY KEY NOT NULL,
	`applied_at` integer NOT NULL
);
INSERT OR REPLACE INTO `sns_agent_schema_version` (`version`, `applied_at`) VALUES ("0011", unixepoch());
