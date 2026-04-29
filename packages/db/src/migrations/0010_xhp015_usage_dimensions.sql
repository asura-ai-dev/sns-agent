ALTER TABLE `usage_records` ADD `gate_id` text;--> statement-breakpoint
ALTER TABLE `usage_records` ADD `feature` text;--> statement-breakpoint
ALTER TABLE `usage_records` ADD `metadata` text;--> statement-breakpoint
CREATE INDEX `idx_usage_records_workspace_endpoint_recorded` ON `usage_records` (`workspace_id`,`endpoint`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_workspace_gate_recorded` ON `usage_records` (`workspace_id`,`gate_id`,`recorded_at`);
