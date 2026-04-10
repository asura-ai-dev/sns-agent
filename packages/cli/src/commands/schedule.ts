/**
 * sns schedule コマンド
 *
 * - sns schedule list [--status <s>] [--json]
 * - sns schedule create --post <id> --at <ISO>
 * - sns schedule show <id> [--json]
 * - sns schedule cancel <id>
 * - sns schedule update <id> --at <ISO>
 *
 * 全コマンドは SDK の SnsAgentClient.schedules リソース経由で API を呼ぶ。
 * show は SDK にメソッドが無いため汎用 client.get で /api/schedules/:id を呼ぶ。
 */

import { Command } from "commander";
import type {
  ApiResponse,
  CreateScheduleInput,
  ListSchedulesParams,
  ScheduledJob,
  UpdateScheduleInput,
} from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** list サブコマンドの列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["POST ID", "postId"],
  ["SCHEDULED AT", "scheduledAt"],
  ["STATUS", "status"],
  ["ATTEMPTS", "attemptCount"],
  ["NEXT RETRY", "nextRetryAt"],
];

/** 親コマンドからグローバルオプションを拾う */
function getGlobalOpts(cmd: Command): GlobalOptions {
  let current: Command | null = cmd;
  while (current) {
    const opts = current.opts() as GlobalOptions;
    if (opts && (opts.json !== undefined || opts.apiUrl || opts.apiKey)) {
      return opts;
    }
    current = current.parent;
  }
  return {};
}

/** 必須文字列オプション */
function requireStr(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw Object.assign(new Error(`--${name} is required`), { code: "VALID_REQUIRED" });
  }
  return value;
}

/** ISO 8601 日時の緩めのバリデーション */
function validateIsoDate(value: string, name: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(
      new Error(`--${name} must be a valid ISO 8601 date-time (e.g. 2026-04-12T09:00:00+09:00)`),
      { code: "VALID_DATE" },
    );
  }
  return value;
}

export function registerScheduleCommand(program: Command): void {
  const schedule = program
    .command("schedule")
    .description("Manage scheduled posts (create, cancel, update)");

  // ---- list ----
  schedule
    .command("list")
    .description("List scheduled jobs")
    .option(
      "--status <status>",
      "Filter by status (pending | running | succeeded | failed | retrying)",
    )
    .action(async (subOpts: { status?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const params: ListSchedulesParams = {};
        if (subOpts.status) params.status = subOpts.status;
        const res = await ctx.client.schedules.list(params);
        const items: ScheduledJob[] = res.data;
        ctx.formatter.data(items, {
          title: `Schedules (${items.length})`,
          columns: LIST_COLUMNS,
          emptyMessage: "No scheduled jobs found.",
        });
      });
    });

  // ---- create ----
  schedule
    .command("create")
    .description("Schedule a post for future publishing")
    .option("--post <id>", "Post id to schedule (required)")
    .option("--at <iso>", "Scheduled time in ISO 8601 (required)")
    .action(async (subOpts: { post?: string; at?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const postId = requireStr(subOpts.post, "post");
        const scheduledAt = validateIsoDate(requireStr(subOpts.at, "at"), "at");
        const input: CreateScheduleInput = { postId, scheduledAt };
        const res = await ctx.client.schedules.create(input);
        ctx.formatter.data(res.data, { title: "Schedule created" });
      });
    });

  // ---- show ----
  schedule
    .command("show <id>")
    .description("Show schedule details")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        // SDK に get メソッドが無いため汎用 client.get を使用
        const res = await ctx.client.get<ApiResponse<ScheduledJob>>(`/api/schedules/${id}`);
        ctx.formatter.data(res.data, { title: `Schedule ${id}` });
      });
    });

  // ---- cancel ----
  schedule
    .command("cancel <id>")
    .description("Cancel a scheduled job")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.schedules.cancel(id);
        ctx.formatter.data(res.data, { title: `Cancelled schedule ${id}` });
      });
    });

  // ---- update ----
  schedule
    .command("update <id>")
    .description("Update a scheduled job's time")
    .option("--at <iso>", "New scheduled time in ISO 8601 (required)")
    .action(async (id: string, subOpts: { at?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const scheduledAt = validateIsoDate(requireStr(subOpts.at, "at"), "at");
        const input: UpdateScheduleInput = { scheduledAt };
        const res = await ctx.client.schedules.update(id, input);
        ctx.formatter.data(res.data, { title: `Updated schedule ${id}` });
      });
    });
}
