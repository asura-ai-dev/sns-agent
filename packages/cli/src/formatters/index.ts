/**
 * フォーマッター選択エントリポイント
 */

import { JsonFormatter } from "./json.js";
import { TableFormatter } from "./table.js";
import type { OutputFormatter } from "./types.js";

export type { OutputFormatter, TableOptions } from "./types.js";
export { JsonFormatter } from "./json.js";
export { TableFormatter } from "./table.js";

/**
 * --json フラグに応じてフォーマッターを選択する。
 */
export function selectFormatter(json: boolean): OutputFormatter {
  return json ? new JsonFormatter() : new TableFormatter();
}
