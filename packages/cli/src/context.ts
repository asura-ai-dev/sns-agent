/**
 * コマンド実行コンテキスト
 *
 * グローバルオプションを束ねて、各コマンドが SDK クライアントと
 * フォーマッターを取り出せるようにする。
 */

import { SnsAgentClient } from "@sns-agent/sdk";
import { resolveConfig, type PartialCliConfig } from "./config.js";
import { selectFormatter, type OutputFormatter } from "./formatters/index.js";
import { normalizeError } from "./errors.js";

export interface GlobalOptions {
  json?: boolean;
  apiUrl?: string;
  apiKey?: string;
}

export interface CommandContext {
  client: SnsAgentClient;
  formatter: OutputFormatter;
  /** JSON モードかどうか */
  json: boolean;
}

/**
 * グローバルオプションから CommandContext を作る。
 * apiKey が未設定なら例外を投げる（実行不可のため）。
 */
export function buildContext(opts: GlobalOptions): CommandContext {
  const cliArgs: PartialCliConfig = {};
  if (opts.apiUrl) cliArgs.apiUrl = opts.apiUrl;
  if (opts.apiKey) cliArgs.apiKey = opts.apiKey;

  const config = resolveConfig({ cliArgs });
  const json = Boolean(opts.json);
  const formatter = selectFormatter(json);

  if (!config.apiKey) {
    // 設定不備: 呼び出し元で catch して formatter 経由で通知する
    const err = new Error(
      "API key is not configured. Provide --api-key, set SNS_API_KEY, or write ~/.sns-agent/config.json.",
    );
    (err as Error & { code?: string }).code = "CONFIG_MISSING_API_KEY";
    throw err;
  }

  const client = new SnsAgentClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  return { client, formatter, json };
}

/**
 * コマンドハンドラをラップし、例外を formatter 経由で通知して
 * 終了コード 1 で exit する共通処理。
 */
export async function runCommand(
  globalOpts: GlobalOptions,
  handler: (ctx: CommandContext) => Promise<void>,
): Promise<void> {
  let ctx: CommandContext | null = null;
  try {
    ctx = buildContext(globalOpts);
    await handler(ctx);
  } catch (err) {
    // context 構築失敗時のフォールバック formatter
    const formatter = ctx?.formatter ?? selectFormatter(Boolean(globalOpts.json));
    const normalized = normalizeError(err);
    // 設定不備エラーの code を拾う
    const maybeCode = (err as { code?: string } | undefined)?.code;
    if (maybeCode && normalized.code === "CLI_ERROR") {
      normalized.code = maybeCode;
    }
    formatter.error(normalized);
    process.exitCode = 1;
  }
}
