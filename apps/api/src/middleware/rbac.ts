/**
 * RBAC ミドルウェア
 *
 * Task 2001: actor の role に基づいて権限チェックを行うファクトリ関数。
 * core の checkPermission() を利用する。
 *
 * design.md セクション 4.4（ミドルウェアチェーン）、セクション 7（RBAC 権限マトリクス）に準拠。
 */
import type { MiddlewareHandler } from "hono";
import { checkPermission } from "@sns-agent/core";
import type { Permission, Actor } from "@sns-agent/core";

/**
 * 指定された権限を要求するミドルウェアを返すファクトリ関数。
 *
 * 使用例:
 *   app.get("/api/posts", requirePermission("post:read"), handler)
 *   app.post("/api/posts", requirePermission("post:create"), handler)
 *
 * actor が context にセットされていない場合（認証ミドルウェア未通過）は 401 を返す。
 * actor の role に指定された権限がない場合は 403 を返す。
 */
export function requirePermission(permission: Permission): MiddlewareHandler {
  return async (c, next) => {
    const actor = c.get("actor") as Actor | undefined;

    if (!actor) {
      return c.json(
        {
          error: {
            code: "AUTH_UNAUTHORIZED",
            message: "Authentication required",
          },
        },
        401,
      );
    }

    if (!checkPermission(actor.role, permission)) {
      return c.json(
        {
          error: {
            code: "AUTH_FORBIDDEN",
            message: `Insufficient permissions: ${permission} required`,
            details: {
              requiredPermission: permission,
              actorRole: actor.role,
            },
          },
        },
        403,
      );
    }

    await next();
  };
}
