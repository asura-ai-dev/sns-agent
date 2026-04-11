/**
 * sns inbox コマンド
 *
 * - sns inbox list [--platform <p>] [--limit <n>] [--json]
 * - sns inbox show <threadId> [--limit <n>] [--json]
 *
 * inbox API (/api/inbox) は Task 6003 で実装済みだが、SDK に専用リソースが
 * まだないため、汎用メソッド (client.get) で直接呼ぶ。
 * API 未実装または権限不足時 (404/403) は errors.ts 経由で整形済みエラーが表示される。
 */

import { Command } from "commander";
import type { ApiResponse, Platform } from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** CLI 側最低限のスレッド型 (SDK に型が無いため) */
interface ConversationThreadLike {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  platform: string;
  externalThreadId: string | null;
  participantName: string | null;
  lastMessageAt: string | null;
  status: string;
  createdAt: string;
}

/** CLI 側最低限のメッセージ型 */
interface MessageLike {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  contentText: string | null;
  contentMedia: unknown | null;
  externalMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** list サブコマンドの列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["PLATFORM", "platform"],
  ["PARTICIPANT", "participantName"],
  ["STATUS", "status"],
  ["LAST MESSAGE AT", "lastMessageAt"],
];

/** show 内のメッセージ列定義 */
const MESSAGE_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["DIR", "direction"],
  ["TEXT", "contentText"],
  ["SENT AT", "sentAt"],
];

/** 許可プラットフォーム */
const ALLOWED_PLATFORMS = ["x", "line", "instagram"] as const;

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

/** platform バリデーション */
function validatePlatform(value: string): Platform {
  if (!ALLOWED_PLATFORMS.includes(value as Platform)) {
    throw Object.assign(
      new Error(`Invalid --platform '${value}'. Expected one of: ${ALLOWED_PLATFORMS.join(", ")}.`),
      { code: "VALID_PLATFORM" },
    );
  }
  return value as Platform;
}

/** 非負整数パース */
function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) {
    throw Object.assign(new Error(`--${name} must be a non-negative integer`), {
      code: "VALID_NUMBER",
    });
  }
  return n;
}

export function registerInboxCommand(program: Command): void {
  const inbox = program.command("inbox").description("View conversation threads and messages");

  // ---- list ----
  inbox
    .command("list")
    .description("List conversation threads")
    .option("--platform <platform>", "Filter by platform (x | line | instagram)")
    .option("--limit <n>", "Maximum number of threads to return")
    .action(async (subOpts: { platform?: string; limit?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const params: Record<string, string | number> = {};
        if (subOpts.platform) params.platform = validatePlatform(subOpts.platform);
        const limit = parsePositiveInt(subOpts.limit, "limit");
        if (limit !== undefined) params.limit = limit;

        const res = await ctx.client.get<ApiResponse<ConversationThreadLike[]>>(
          "/api/inbox",
          params,
        );
        const items = res.data;
        ctx.formatter.data(items, {
          title: `Threads (${items.length})`,
          columns: LIST_COLUMNS,
          emptyMessage: "No threads found.",
        });
      });
    });

  // ---- show ----
  inbox
    .command("show <threadId>")
    .description("Show messages in a conversation thread")
    .option("--limit <n>", "Maximum number of messages to return")
    .action(async (threadId: string, subOpts: { limit?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const params: Record<string, string | number> = {};
        const limit = parsePositiveInt(subOpts.limit, "limit");
        if (limit !== undefined) params.limit = limit;

        const res = await ctx.client.get<
          ApiResponse<{ thread: ConversationThreadLike; messages: MessageLike[] }>
        >(`/api/inbox/${threadId}`, params);

        if (ctx.json) {
          ctx.formatter.data(res.data, { title: `Thread ${threadId}` });
          return;
        }

        // 人間可読モードではメッセージテーブルを主体に表示する
        const messages = res.data.messages ?? [];
        ctx.formatter.data(messages, {
          title: `Thread ${threadId} (${messages.length} messages)`,
          columns: MESSAGE_COLUMNS,
          emptyMessage: "No messages in this thread.",
        });
      });
    });
}
