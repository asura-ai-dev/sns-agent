/**
 * 出力フォーマッターの共通インターフェース
 *
 * コマンドは OutputFormatter に対してデータを渡し、
 * --json 指定時は JsonFormatter、それ以外は TableFormatter が選択される。
 */

export interface OutputFormatter {
  /**
   * 単一のオブジェクトや成功結果を標準出力に書き出す。
   * @param data - 出力対象
   * @param options - テーブル表示用の任意オプション（JSON 時は無視）
   */
  data(data: unknown, options?: TableOptions): void;

  /**
   * エラーメッセージを出力する。
   * JSON フォーマッターは stdout に JSON を書き、
   * テーブルフォーマッターは stderr に人間可読メッセージを書く。
   */
  error(err: { code: string; message: string; details?: unknown }): void;

  /**
   * 情報メッセージ（連絡事項、ガイダンス等）を出力する。
   * JSON フォーマッターは { type: "info", message } を stdout に書き、
   * テーブルフォーマッターは stderr に書く（stdout をパース可能な状態に保つため）。
   */
  info(message: string): void;
}

/**
 * テーブル描画のヒント。
 * columns を指定すると、配列データの列を選択できる。
 */
export interface TableOptions {
  /** カラム定義: [ヘッダー表示名, データキー] のペア配列 */
  columns?: Array<[string, string]>;
  /** タイトル行（テーブル上部に表示） */
  title?: string;
  /** データが空のときに表示するメッセージ */
  emptyMessage?: string;
}
