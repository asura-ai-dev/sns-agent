/**
 * sns accounts コマンド
 *
 * - sns accounts list [--platform <p>] [--json]
 * - sns accounts show <id> [--json]
 * - sns accounts connect <platform> [--json]
 * - sns accounts disconnect <id> [--json]
 *
 * 全コマンドは SDK の SnsAgentClient 経由で API を呼び、
 * フォーマッターに結果を渡す。エラーは runCommand で一元処理。
 */

import { Command } from "commander";
import type { Platform, SocialAccount } from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** 一覧表示用の列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["PLATFORM", "platform"],
  ["DISPLAY NAME", "displayName"],
  ["STATUS", "status"],
  ["EXPIRES AT", "tokenExpiresAt"],
];

/** 親コマンドからグローバルオプションを拾う */
function getGlobalOpts(cmd: Command): GlobalOptions {
  // commander では parent -> program まで遡ってグローバルオプションを取得する
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

export function registerAccountsCommand(program: Command): void {
  const accounts = program.command("accounts").description("Manage connected SNS accounts");

  // ---- list ----
  accounts
    .command("list")
    .description("List connected accounts")
    .option("--platform <platform>", "Filter by platform (x | line | instagram)")
    .action(async (subOpts: { platform?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.accounts.list();
        let items: SocialAccount[] = res.data;
        if (subOpts.platform) {
          items = items.filter((a) => a.platform === subOpts.platform);
        }
        ctx.formatter.data(items, {
          title: `Accounts (${items.length})`,
          columns: LIST_COLUMNS,
          emptyMessage: "No accounts connected.",
        });
      });
    });

  // ---- show ----
  accounts
    .command("show <id>")
    .description("Show account details")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.accounts.get(id);
        ctx.formatter.data(res.data, { title: `Account ${id}` });
      });
    });

  // ---- connect ----
  accounts
    .command("connect <platform>")
    .description("Start OAuth connection for a platform (x | line | instagram)")
    .option(
      "--redirect-url <url>",
      "Redirect URL after OAuth (defaults to http://localhost:3001/oauth/callback)",
    )
    .action(async (platform: string, subOpts: { redirectUrl?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        if (!["x", "line", "instagram"].includes(platform)) {
          throw Object.assign(
            new Error(`Unsupported platform '${platform}'. Expected one of: x, line, instagram.`),
            { code: "VALID_PLATFORM" },
          );
        }
        const redirectUrl = subOpts.redirectUrl ?? "http://localhost:3001/oauth/callback";
        const res = await ctx.client.accounts.connect({
          platform: platform as Platform,
          redirectUrl,
        });

        // API は認可 URL を返すことを期待する。レスポンスに authorizationUrl があれば案内する。
        const authUrl = (res.data as unknown as { authorizationUrl?: string }).authorizationUrl;
        if (authUrl) {
          ctx.formatter.info(`Open this URL in your browser to authorize:\n  ${authUrl}`);
        }
        ctx.formatter.data(res.data, { title: `Connect ${platform}` });
      });
    });

  // ---- disconnect ----
  accounts
    .command("disconnect <id>")
    .description("Disconnect an account")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.accounts.disconnect(id);
        ctx.formatter.data(res.data, { title: `Disconnected ${id}` });
      });
    });
}
