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
  RunDueSchedulesResult,
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

const EXECUTION_LOG_COLUMNS: Array<[string, string]> = [
  ["AT", "createdAt"],
  ["STATUS", "status"],
  ["RETRY", "retryDecision"],
  ["ATTEMPT", "attemptLabel"],
  ["MESSAGE", "message"],
  ["NEXT RETRY", "nextRetryAt"],
  ["CONFIRM", "confirmTarget"],
];

interface ScheduleNotificationTargetResponse {
  type: "post_creator" | "workspace_admin";
  actorId: string | null;
  label: string;
  reason: string;
}

interface ScheduleExecutionLogResponse {
  id: string;
  action: string;
  status: "succeeded" | "retrying" | "failed";
  createdAt: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  message: string;
  error: string | null;
  willRetry: boolean;
  retryable: boolean | null;
  retryRule: "retryable" | "non_retryable" | "exhausted" | "not_applicable";
  classificationReason: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  nextRetryAt: string | null;
  notificationTarget: ScheduleNotificationTargetResponse | null;
}

interface ScheduleOperationalDetailResponse {
  post: {
    id: string;
    status: string;
    platform: string;
    socialAccountId: string;
    contentText: string | null;
    createdBy: string | null;
  } | null;
  retryPolicy: {
    maxAttempts: number;
    backoffSeconds: number[];
    retryableRule: string;
    nonRetryableRule: string;
  };
  notificationTarget: ScheduleNotificationTargetResponse;
  latestExecution: ScheduleExecutionLogResponse | null;
  executionLogs: ScheduleExecutionLogResponse[];
  recommendedAction: string;
}

interface ScheduleDetailResponse extends ApiResponse<ScheduledJob> {
  detail?: ScheduleOperationalDetailResponse;
}

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

async function fetchScheduleDetail(
  apiGet: <T>(path: string) => Promise<T>,
  id: string,
): Promise<ScheduleDetailResponse> {
  return apiGet<ScheduleDetailResponse>(`/api/schedules/${id}`);
}

function toExecutionLogRows(detail: ScheduleOperationalDetailResponse | undefined) {
  return (detail?.executionLogs ?? []).map((log) => ({
    createdAt: log.createdAt,
    status: log.status,
    retryDecision: log.willRetry
      ? "auto retry"
      : log.retryRule === "non_retryable"
        ? "stop"
        : log.retryRule === "exhausted"
          ? "max reached"
          : "-",
    attemptLabel:
      log.attemptCount !== null && log.maxAttempts !== null
        ? `${log.attemptCount}/${log.maxAttempts}`
        : "-",
    message: log.error ? `${log.message} (${log.error})` : log.message,
    nextRetryAt: log.nextRetryAt ?? "-",
    confirmTarget: log.notificationTarget?.label ?? "-",
  }));
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
    .description("Show schedule details and operational guidance")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await fetchScheduleDetail(ctx.client.get.bind(ctx.client), id);
        if (ctx.json) {
          ctx.formatter.data(res, { title: `Schedule ${id}` });
          return;
        }

        ctx.formatter.data(res.data, { title: `Schedule ${id}` });

        if (res.detail) {
          ctx.formatter.data(
            {
              retryRule: res.detail.retryPolicy.retryableRule,
              noRetryRule: res.detail.retryPolicy.nonRetryableRule,
              confirmTarget: res.detail.notificationTarget.label,
              confirmReason: res.detail.notificationTarget.reason,
              recommendedAction: res.detail.recommendedAction,
            },
            { title: "Operations" },
          );

          const logRows = toExecutionLogRows(res.detail);
          ctx.formatter.data(logRows, {
            title: "Execution logs",
            columns: EXECUTION_LOG_COLUMNS,
            emptyMessage: "No execution logs recorded yet.",
          });
        }
      });
    });

  // ---- logs ----
  schedule
    .command("logs <id>")
    .description("Show execution logs for a scheduled job")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await fetchScheduleDetail(ctx.client.get.bind(ctx.client), id);
        const logs = res.detail?.executionLogs ?? [];

        if (ctx.json) {
          ctx.formatter.data(logs, { title: `Schedule logs ${id}` });
          return;
        }

        ctx.formatter.data(toExecutionLogRows(res.detail), {
          title: `Schedule logs ${id}`,
          columns: EXECUTION_LOG_COLUMNS,
          emptyMessage: "No execution logs recorded yet.",
        });
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

  // ---- run-due ----
  schedule
    .command("run-due")
    .description("Run due scheduled jobs once (manual dispatcher tick)")
    .option("--limit <n>", "Maximum number of due jobs to execute in this run")
    .action(async (subOpts: { limit?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const limit =
          subOpts.limit !== undefined
            ? Number.parseInt(requireStr(subOpts.limit, "limit"), 10)
            : undefined;
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
          throw Object.assign(new Error("--limit must be a positive integer"), {
            code: "VALID_LIMIT",
          });
        }

        const res = await ctx.client.schedules.runDue(limit ? { limit } : undefined);
        const data = res.data as RunDueSchedulesResult;
        ctx.formatter.data(data, {
          title: `Due jobs run complete (${data.processed}/${data.scanned})`,
        });
      });
    });
}
