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
