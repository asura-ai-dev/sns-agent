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
