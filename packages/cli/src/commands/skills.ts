/**
 * sns skills コマンド
 *
 * - sns skills list [--json]
 * - sns skills pack --platform <p> --provider <llm-provider>
 * - sns skills enable <id>
 * - sns skills disable <id>
 * - sns skills show <id> [--json]
 *
 * skills API は Phase 5 で実装される。SDK には専用リソースがまだないため、
 * 汎用メソッド (client.get / post) で /api/skills を直接呼ぶ。
 * API 未実装時 (404) は errors.ts 経由で整形済みエラーが表示される。
 */

import { Command } from "commander";
import type { ApiResponse } from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** skills パッケージの最低限の型 (SDK 側に型が無いため CLI 内で定義) */
interface SkillPackage {
  id: string;
  name?: string;
  platform: string;
  provider: string;
  version?: string;
  enabled?: boolean;
  manifest?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

/** list サブコマンドの列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["NAME", "name"],
  ["PLATFORM", "platform"],
  ["PROVIDER", "provider"],
  ["VERSION", "version"],
  ["ENABLED", "enabled"],
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

/** 必須文字列オプションの取得。未指定なら CLI_ERROR を投げる */
function requireStr(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw Object.assign(new Error(`--${name} is required`), { code: "VALID_REQUIRED" });
  }
  return value;
}

export function registerSkillsCommand(program: Command): void {
  const skills = program.command("skills").description("Manage skills packages");

  // ---- list ----
  skills
    .command("list")
    .description("List all skills packages")
    .action(async (_subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.get<ApiResponse<SkillPackage[]>>("/api/skills");
        const items = res.data ?? [];
        ctx.formatter.data(items, {
          title: `Skills packages (${items.length})`,
          columns: LIST_COLUMNS,
          emptyMessage: "No skills packages found.",
        });
      });
    });

  // ---- pack ----
  skills
    .command("pack")
    .description("Generate a skills package for a platform and LLM provider")
    .option("--platform <platform>", "Target platform (x | line | instagram)")
    .option("--provider <provider>", "Target LLM provider (e.g. claude-code, codex)")
    .action(async (subOpts: { platform?: string; provider?: string }, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const platform = requireStr(subOpts.platform, "platform");
        const provider = requireStr(subOpts.provider, "provider");
        const body = { platform, provider };
        const res = await ctx.client.post<ApiResponse<SkillPackage>>("/api/skills/pack", body);
        ctx.formatter.data(res.data, {
          title: `Generated skills package (${platform} / ${provider})`,
        });
      });
    });

  // ---- enable ----
  skills
    .command("enable <id>")
    .description("Enable a skills package")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.post<ApiResponse<SkillPackage>>(
          `/api/skills/${encodeURIComponent(id)}/enable`,
        );
        ctx.formatter.data(res.data, { title: `Enabled skills package ${id}` });
      });
    });

  // ---- disable ----
  skills
    .command("disable <id>")
    .description("Disable a skills package")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.post<ApiResponse<SkillPackage>>(
          `/api/skills/${encodeURIComponent(id)}/disable`,
        );
        ctx.formatter.data(res.data, { title: `Disabled skills package ${id}` });
      });
    });

  // ---- show ----
  skills
    .command("show <id>")
    .description("Show a skills package manifest and metadata")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.get<ApiResponse<SkillPackage>>(
          `/api/skills/${encodeURIComponent(id)}`,
        );
        ctx.formatter.data(res.data, { title: `Skills package ${id}` });
      });
    });
}
