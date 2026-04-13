/**
 * 承認ポリシー定義
 *
 * Task 6002: 書き込み操作が承認を必要とするか判定する。
 * design.md セクション 4.2（承認）、architecture.md セクション 12.3（承認対象）に準拠。
 *
 * デフォルトで承認が必要な操作:
 *   - agent ロールによる投稿公開 (post:publish)
 *   - 予算超過（action_on_exceed = 'require-approval'）時の操作続行
 *   - LINE broadcast（全友だち配信）
 *
 * admin / owner は承認不要（direct-execute モード）。
 * viewer / operator / editor は通常の RBAC で post:publish が許可/不許可になるため、
 * ここではロール起点の判定は agent に絞る。
 */
import type { Role, Platform } from "@sns-agent/config";

/**
 * 承認判定の対象アクション種別。
 * design.md および architecture.md で列挙された書き込み操作に対応する。
 */
export type ApprovalAction =
  | "post:publish"
  | "post:delete"
  | "budget:exceed-continue"
  | "line:broadcast"
  | "inbox:reply";

/**
 * 承認判定のためのコンテキスト。
 * action ごとに必要なフィールドが異なるため全てオプショナル。
 */
export interface ApprovalContext {
  /** 対象プラットフォーム（line:broadcast 判定等で使用） */
  platform?: Platform;
  /** 予算ポリシーの action_on_exceed（budget:exceed-continue 判定で使用） */
  budgetActionOnExceed?: "warn" | "require-approval" | "block";
  /** ワークスペース設定で承認を強制するか（将来拡張用） */
  workspaceRequireApproval?: boolean;
}

/**
 * 承認ルール設定。ワークスペース単位で上書き可能にする想定。
 * v1 は固定値としてデフォルトを返すが、将来 WorkspaceSetting から読み込み可能にする。
 */
export interface ApprovalPolicyConfig {
  /** agent ロールの投稿公開を承認必須にするか */
  agentPostPublishRequiresApproval: boolean;
  /** agent ロールの投稿削除を承認必須にするか */
  agentPostDeleteRequiresApproval: boolean;
  /** LINE broadcast を承認必須にするか */
  lineBroadcastRequiresApproval: boolean;
  /** agent ロールの inbox reply を承認必須にするか */
  agentInboxReplyRequiresApproval: boolean;
  /** admin/owner を承認スキップ対象にするか（false で全員承認を受ける） */
  adminBypass: boolean;
}

/**
 * v1 デフォルト設定。
 * architecture.md 12.3 に沿って保守的デフォルトを採用する。
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicyConfig = {
  agentPostPublishRequiresApproval: true,
  agentPostDeleteRequiresApproval: true,
  lineBroadcastRequiresApproval: true,
  agentInboxReplyRequiresApproval: true,
  adminBypass: true,
};

/**
 * 操作が承認を必要とするか判定する。
 *
 * 判定順:
 *   1. admin / owner は adminBypass が有効なら承認不要
 *   2. 予算超過で action_on_exceed = 'require-approval' のコンテキストは常に承認必要
 *   3. LINE broadcast は lineBroadcastRequiresApproval に従う
 *   4. agent ロールの post:publish / post:delete は設定に従う
 *   5. 上記に該当しなければ承認不要
 */
export function requiresApproval(
  action: ApprovalAction,
  actorRole: Role,
  context: ApprovalContext = {},
  config: ApprovalPolicyConfig = DEFAULT_APPROVAL_POLICY,
): boolean {
  // 予算超過時の続行は最優先で承認必要
  if (action === "budget:exceed-continue") {
    return context.budgetActionOnExceed === "require-approval";
  }

  // admin / owner は bypass
  if (config.adminBypass && (actorRole === "admin" || actorRole === "owner")) {
    return false;
  }

  // LINE broadcast は platform によらずアクション種別で判定
  if (action === "line:broadcast") {
    return config.lineBroadcastRequiresApproval;
  }

  if (action === "post:publish") {
    // agent ロールの投稿公開は設定に従う
    if (actorRole === "agent") {
      return config.agentPostPublishRequiresApproval;
    }
    // その他の role は RBAC 通過済みで承認不要
    return false;
  }

  if (action === "post:delete") {
    if (actorRole === "agent") {
      return config.agentPostDeleteRequiresApproval;
    }
    return false;
  }

  if (action === "inbox:reply") {
    if (actorRole === "agent") {
      return config.agentInboxReplyRequiresApproval;
    }
    return false;
  }

  return false;
}
