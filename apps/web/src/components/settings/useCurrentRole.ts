/**
 * useCurrentRole - 現在のユーザーロールを取得するフック
 *
 * Phase 3 時点では認証連携が未実装のため、以下の優先順でロールを決定する:
 *   1. URL クエリ `?role=admin` 等（デモ・確認用）
 *   2. localStorage の `sns-agent:demo-role`
 *   3. デフォルト: "admin"
 *
 * 後続フェーズ（認証実装）でサーバーセッションからの取得に差し替える。
 */
"use client";

import { useEffect, useState } from "react";
import type { Role } from "./RoleBadge";

const STORAGE_KEY = "sns-agent:demo-role";
const VALID_ROLES: Role[] = ["viewer", "operator", "editor", "admin", "owner", "agent"];

function isValidRole(v: string | null): v is Role {
  return !!v && (VALID_ROLES as string[]).includes(v);
}

export function useCurrentRole(): {
  role: Role;
  setRole: (role: Role) => void;
  isAdmin: boolean;
} {
  const [role, setRoleState] = useState<Role>("admin");

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const queryRole = url.searchParams.get("role");
      if (isValidRole(queryRole)) {
        setRoleState(queryRole);
        window.localStorage.setItem(STORAGE_KEY, queryRole);
        return;
      }
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isValidRole(stored)) {
        setRoleState(stored);
      }
    } catch {
      // localStorage 未対応等、無視
    }
  }, []);

  const setRole = (next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // noop
    }
  };

  return {
    role,
    setRole,
    isAdmin: role === "admin" || role === "owner",
  };
}

export { VALID_ROLES };
