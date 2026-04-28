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
