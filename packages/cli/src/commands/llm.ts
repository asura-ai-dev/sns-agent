/**
 * sns llm コマンド
 *
 * - sns llm route list [--json]
 * - sns llm route set --platform <p> [--action <a>] --provider <p> --model <m>
 *                    [--temperature <t>] [--max-tokens <n>]
 *                    [--fallback-provider <p>] [--fallback-model <m>]
 * - sns llm route delete <id>
 *
 * llm ルーティング API は Phase 5 で実装される。SDK には専用リソースがまだないため、
 * 汎用メソッド (client.get / post / delete) で /api/llm/routes を直接呼ぶ。
 * API 未実装時 (404) は errors.ts 経由で整形済みエラーが表示される。
 */

import { Command } from "commander";
import type { ApiResponse } from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** LLM ルート設定のクライアント側最低限の型 (SDK 側に型が無いため CLI 内で定義) */
interface LlmRoute {
  id: string;
  platform: string;
  action?: string | null;
  provider: string;
  model: string;
  temperature?: number | null;
  maxTokens?: number | null;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** list サブコマンドの列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["PLATFORM", "platform"],
  ["ACTION", "action"],
  ["PROVIDER", "provider"],
  ["MODEL", "model"],
  ["TEMP", "temperature"],
  ["MAX_TOKENS", "maxTokens"],
  ["FALLBACK", "fallbackProvider"],
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

/** 数値オプションのパース。未指定なら undefined、不正なら例外 */
function parseNumericOpt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`--${name} must be a number, got '${value}'`), {
      code: "VALID_NUMBER",
    });
  }
  return n;
}

export function registerLlmCommand(program: Command): void {
  const llm = program.command("llm").description("Manage LLM routing configuration");
  const route = llm.command("route").description("Manage LLM routing rules");

  // ---- route list ----
  route
    .command("list")
    .description("List all LLM routing rules")
    .action(async (_subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.get<ApiResponse<LlmRoute[]>>("/api/llm/routes");
        const items = res.data ?? [];
        ctx.formatter.data(items, {
          title: `LLM routes (${items.length})`,
          columns: LIST_COLUMNS,
          emptyMessage: "No LLM routes configured.",
        });
      });
    });

  // ---- route set ----
  route
    .command("set")
    .description("Create or update an LLM routing rule")
    .option("--platform <platform>", "Target platform (x | line | instagram)")
    .option("--action <action>", "Target action name (optional)")
    .option("--provider <provider>", "LLM provider name (required)")
    .option("--model <model>", "LLM model name (required)")
    .option("--temperature <t>", "Sampling temperature (optional)")
    .option("--max-tokens <n>", "Maximum output tokens (optional)")
    .option("--fallback-provider <p>", "Fallback provider (optional)")
    .option("--fallback-model <m>", "Fallback model (optional)")
    .action(
      async (
        subOpts: {
          platform?: string;
          action?: string;
          provider?: string;
          model?: string;
          temperature?: string;
          maxTokens?: string;
          fallbackProvider?: string;
          fallbackModel?: string;
        },
        cmd: Command,
      ) => {
        const globals = getGlobalOpts(cmd);
        await runCommand(globals, async (ctx) => {
          const platform = requireStr(subOpts.platform, "platform");
          const provider = requireStr(subOpts.provider, "provider");
          const model = requireStr(subOpts.model, "model");
          const temperature = parseNumericOpt(subOpts.temperature, "temperature");
          const maxTokens = parseNumericOpt(subOpts.maxTokens, "max-tokens");

          // fallback は片方だけ指定された場合はエラー
          if (
            (subOpts.fallbackProvider && !subOpts.fallbackModel) ||
            (!subOpts.fallbackProvider && subOpts.fallbackModel)
          ) {
            throw Object.assign(
              new Error("--fallback-provider and --fallback-model must be specified together"),
              { code: "VALID_FALLBACK_PAIR" },
            );
          }

          const body: Record<string, unknown> = {
            platform,
            provider,
            model,
          };
          if (subOpts.action) body.action = subOpts.action;
          if (temperature !== undefined) body.temperature = temperature;
          if (maxTokens !== undefined) body.maxTokens = maxTokens;
          if (subOpts.fallbackProvider && subOpts.fallbackModel) {
            body.fallbackProvider = subOpts.fallbackProvider;
            body.fallbackModel = subOpts.fallbackModel;
          }

          const res = await ctx.client.post<ApiResponse<LlmRoute>>("/api/llm/routes", body);
          ctx.formatter.data(res.data, { title: "LLM route saved" });
        });
      },
    );

  // ---- route delete ----
  route
    .command("delete <id>")
    .description("Delete an LLM routing rule by ID")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.delete<ApiResponse<{ success: boolean }>>(
          `/api/llm/routes/${encodeURIComponent(id)}`,
        );
        ctx.formatter.data(res.data, { title: `Deleted LLM route ${id}` });
      });
    });
}
