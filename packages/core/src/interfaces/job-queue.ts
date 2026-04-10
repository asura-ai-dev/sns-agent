/**
 * JobQueue インターフェース定義
 *
 * design.md セクション 1.3 に準拠。
 * v1 は DB ベース queue で実装し、将来的に BullMQ 等に差し替え可能にする。
 */
import type { ScheduledJob } from "../domain/entities.js";

export interface JobQueue {
  /**
   * ジョブをキューに追加する。
   */
  enqueue(job: Omit<ScheduledJob, "id" | "createdAt">): Promise<ScheduledJob>;

  /**
   * 実行可能なジョブをキューから取り出す。
   * ジョブはアトミックにロックされる。
   * 実行可能なジョブがない場合は null を返す。
   */
  dequeue(): Promise<ScheduledJob | null>;

  /**
   * ジョブを成功完了としてマークする。
   */
  complete(jobId: string): Promise<void>;

  /**
   * ジョブを失敗としてマークする。
   * max_attempts に達していない場合は retrying 状態に遷移する。
   */
  fail(jobId: string, error: string): Promise<void>;

  /**
   * ジョブを再試行状態に明示的に設定する。
   */
  retry(jobId: string): Promise<void>;
}
