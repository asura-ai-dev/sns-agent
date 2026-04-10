/**
 * 認証ユースケース
 *
 * Task 2001: API キーまたはユーザー ID から actor 情報を解決する。
 * ミドルウェアから呼び出され、認証済みの actor を返す。
 */
import type { Role } from "@sns-agent/config";
import type { User, AgentIdentity, ActorType } from "../domain/entities.js";

// ───────────────────────────────────────────
// Actor 型（ミドルウェアが c.set("actor", actor) でセットする）
// ───────────────────────────────────────────

export interface Actor {
  id: string;
  type: ActorType;
  role: Role;
  workspaceId: string;
}

// ───────────────────────────────────────────
// Repository インターフェース（db パッケージが実装する）
// ───────────────────────────────────────────

export interface AuthUserRepository {
  findById(id: string): Promise<User | null>;
}

export interface AuthAgentIdentityRepository {
  findByApiKeyHash(apiKeyHash: string): Promise<AgentIdentity | null>;
}

// ───────────────────────────────────────────
// ユースケース関数
// ───────────────────────────────────────────

/**
 * API キーハッシュから AgentIdentity を検索し、Actor を返す。
 * 見つからない場合は null を返す。
 */
export async function resolveActorByApiKey(
  repo: AuthAgentIdentityRepository,
  apiKeyHash: string,
): Promise<Actor | null> {
  const identity = await repo.findByApiKeyHash(apiKeyHash);
  if (!identity) {
    return null;
  }
  return {
    id: identity.id,
    type: "agent",
    role: identity.role,
    workspaceId: identity.workspaceId,
  };
}

/**
 * ユーザー ID から User を検索し、Actor を返す。
 * 見つからない場合は null を返す。
 */
export async function resolveActorByUserId(
  repo: AuthUserRepository,
  userId: string,
): Promise<Actor | null> {
  const user = await repo.findById(userId);
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    type: "user",
    role: user.role,
    workspaceId: user.workspaceId,
  };
}
