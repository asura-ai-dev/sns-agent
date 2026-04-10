#!/usr/bin/env node
/**
 * sns CLI エントリポイント
 *
 * グローバルオプション:
 *   --json           JSON 出力モード
 *   --api-url <url>  API URL を上書き
 *   --api-key <key>  API キーを上書き
 *
 * 設定の優先度:
 *   CLI 引数 > 環境変数 (SNS_API_URL, SNS_API_KEY) > ~/.sns-agent/config.json
 *
 * 終了コード:
 *   0 = 成功、1 = エラー（例外発生時）
 */

import { Command } from "commander";
import { registerAccountsCommand } from "./commands/accounts.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerLlmCommand } from "./commands/llm.js";
import { registerSkillsCommand } from "./commands/skills.js";

const program = new Command();

program
  .name("sns")
  .description("SNS Agent CLI - manage X / LINE / Instagram from a single tool")
  .version("0.0.0")
  .option("--json", "Output as JSON (machine-parseable)")
  .option("--api-url <url>", "API base URL (default: env SNS_API_URL or http://localhost:3001)")
  .option("--api-key <key>", "API key (default: env SNS_API_KEY or ~/.sns-agent/config.json)")
  // サブコマンド間でもグローバルオプションを継承できるようにする
  .enablePositionalOptions();

// ---- サブコマンド登録 ----
registerAccountsCommand(program);
registerUsageCommand(program);
registerLlmCommand(program);
registerSkillsCommand(program);

// ---- エラー時に終了コード 1 を保証 ----
program.exitOverride((err) => {
  // commander 自身のヘルプ出力等は exitCode 0
  if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
    process.exit(0);
  }
  if (err.code === "commander.help") {
    process.exit(0);
  }
  process.exit(1);
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // parseAsync 内で投げられた例外（commander の exitOverride 経由を含む）
    const code = (err as { code?: string } | undefined)?.code;
    if (
      code === "commander.helpDisplayed" ||
      code === "commander.version" ||
      code === "commander.help"
    ) {
      process.exit(0);
    }
    // runCommand は process.exitCode を設定して正常 return するため、
    // ここに来るのは commander parser 由来のエラーのみ
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = 1;
    }
  }
  // runCommand が exitCode を設定していればそれを尊重する
  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

main();
