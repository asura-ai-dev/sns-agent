/**
 * テーブル (人間可読) フォーマッター
 *
 * デフォルト出力モード。配列データはテーブル形式、
 * 単一オブジェクトは key: value のリスト形式で出力する。
 * エラーは stderr に書く。
 */

import type { OutputFormatter, TableOptions } from "./types.js";

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getField(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  // ドット区切りで深いキーにアクセス
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + " ".repeat(width - str.length);
}

function renderTable(rows: unknown[], columns: Array<[string, string]>): string {
  // 各列のヘッダとセルの最大幅を計算
  const headers = columns.map(([h]) => h);
  const cells: string[][] = rows.map((row) =>
    columns.map(([, key]) => stringify(getField(row, key))),
  );
  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const row of cells) {
      if (row[i]!.length > w) w = row[i]!.length;
    }
    return w;
  });

  const renderRow = (cols: string[]): string =>
    cols.map((c, i) => padRight(c, widths[i]!)).join("  ");

  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const lines: string[] = [];
  lines.push(renderRow(headers));
  lines.push(sep);
  for (const row of cells) {
    lines.push(renderRow(row));
  }
  return lines.join("\n");
}

function renderKeyValue(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const width = keys.reduce((m, k) => (k.length > m ? k.length : m), 0);
  return keys.map((k) => `${padRight(k, width)}  ${stringify(obj[k])}`).join("\n");
}

export class TableFormatter implements OutputFormatter {
  data(data: unknown, options?: TableOptions): void {
    // 配列データ: テーブル表示
    if (Array.isArray(data)) {
      if (options?.title) {
        process.stdout.write(`${options.title}\n`);
      }
      if (data.length === 0) {
        process.stdout.write(`${options?.emptyMessage ?? "(no records)"}\n`);
        return;
      }
      const columns = options?.columns ?? this._inferColumns(data[0]);
      process.stdout.write(`${renderTable(data, columns)}\n`);
      return;
    }

    // 単一オブジェクト: key/value リスト
    if (data !== null && typeof data === "object") {
      if (options?.title) {
        process.stdout.write(`${options.title}\n`);
      }
      process.stdout.write(`${renderKeyValue(data as Record<string, unknown>)}\n`);
      return;
    }

    // プリミティブ
    process.stdout.write(`${stringify(data)}\n`);
  }

  error(err: { code: string; message: string; details?: unknown }): void {
    process.stderr.write(`Error [${err.code}]: ${err.message}\n`);
    if (err.details !== undefined && err.details !== null) {
      try {
        process.stderr.write(`Details: ${JSON.stringify(err.details)}\n`);
      } catch {
        process.stderr.write(`Details: ${String(err.details)}\n`);
      }
    }
  }

  info(message: string): void {
    // info は stderr に書き、stdout は純粋なデータ出力のみに保つ
    process.stderr.write(`${message}\n`);
  }

  /** 最初の要素から列を推測する */
  private _inferColumns(sample: unknown): Array<[string, string]> {
    if (sample === null || typeof sample !== "object") return [["value", ""]];
    return Object.keys(sample as Record<string, unknown>).map((k) => [k, k] as [string, string]);
  }
}
