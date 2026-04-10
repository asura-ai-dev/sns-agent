/**
 * CLI 設定読み込み
 *
 * 優先度: CLI 引数 > 環境変数 (SNS_API_URL, SNS_API_KEY) > ~/.sns-agent/config.json
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  apiKey: string;
}

/** 部分的な設定 (設定ファイルやグローバルオプションから読み込む際の中間表現) */
export interface PartialCliConfig {
  apiUrl?: string;
  apiKey?: string;
}

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * ~/.sns-agent/config.json を読み込む。
 * ファイルが無い / 壊れている場合は空オブジェクトを返す。
 */
export function readConfigFile(path?: string): PartialCliConfig {
  const configPath = path ?? join(homedir(), ".sns-agent", "config.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const out: PartialCliConfig = {};
      if (typeof obj.apiUrl === "string") out.apiUrl = obj.apiUrl;
      if (typeof obj.apiKey === "string") out.apiKey = obj.apiKey;
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 環境変数から設定を読む。
 */
export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): PartialCliConfig {
  const out: PartialCliConfig = {};
  if (typeof env.SNS_API_URL === "string" && env.SNS_API_URL.length > 0) {
    out.apiUrl = env.SNS_API_URL;
  }
  if (typeof env.SNS_API_KEY === "string" && env.SNS_API_KEY.length > 0) {
    out.apiKey = env.SNS_API_KEY;
  }
  return out;
}

/**
 * 優先度を適用して最終設定を解決する。
 * 優先度: cliArgs > env > file > default
 *
 * apiKey が解決できない場合は空文字を許容する（呼び出し時点でエラーにはしない）。
 * apiUrl が解決できない場合は DEFAULT_API_URL を使用する。
 */
export function resolveConfig(opts: {
  cliArgs: PartialCliConfig;
  env?: NodeJS.ProcessEnv;
  configFilePath?: string;
}): CliConfig {
  const file = readConfigFile(opts.configFilePath);
  const env = readEnvConfig(opts.env ?? process.env);
  const cli = opts.cliArgs;

  const apiUrl = cli.apiUrl ?? env.apiUrl ?? file.apiUrl ?? DEFAULT_API_URL;
  const apiKey = cli.apiKey ?? env.apiKey ?? file.apiKey ?? "";

  return { apiUrl, apiKey };
}
