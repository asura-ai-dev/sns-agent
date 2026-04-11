"use client";

/**
 * 承認フローのクライアント state + polling hook。
 * Task 6002: Header / Dropdown / Dialog から共通に利用する。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { approveApproval, fetchApprovals, rejectApproval } from "./api";
import type { ApprovalRequestDto } from "./types";

export interface UseApprovalsResult {
  data: ApprovalRequestDto[];
  pendingCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  approve: (id: string) => Promise<boolean>;
  reject: (id: string, reason?: string) => Promise<boolean>;
}

/**
 * 承認待ち一覧をポーリング取得する hook。
 * - tab が非表示なら poll しない
 * - fetch 失敗時は fail-open（data=[], pendingCount=0）
 * - approve/reject 後は楽観的にリストから除去 + 即 refresh
 */
export function useApprovals(pollingMs = 30000): UseApprovalsResult {
  const [data, setData] = useState<ApprovalRequestDto[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchApprovals("pending", 10);
      if (!mountedRef.current) return;
      setData(res.data);
      setPendingCount(res.meta.pendingCount ?? res.data.length);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // 初回 + polling
  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    };
    const interval = window.setInterval(tick, pollingMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollingMs]);

  const approve = useCallback(
    async (id: string): Promise<boolean> => {
      // 楽観的に削除
      setData((prev) => prev.filter((r) => r.id !== id));
      setPendingCount((prev) => Math.max(0, prev - 1));
      const result = await approveApproval(id);
      // サーバー状態同期
      await refresh();
      return result !== null;
    },
    [refresh],
  );

  const reject = useCallback(
    async (id: string, reason?: string): Promise<boolean> => {
      setData((prev) => prev.filter((r) => r.id !== id));
      setPendingCount((prev) => Math.max(0, prev - 1));
      const result = await rejectApproval(id, reason);
      await refresh();
      return result !== null;
    },
    [refresh],
  );

  return { data, pendingCount, loading, error, refresh, approve, reject };
}
