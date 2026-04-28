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
