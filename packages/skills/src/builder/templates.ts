/**
 * Skill Action ビルトインテンプレート (Task 5003)
 *
 * 各 SNS プラットフォームの基本アクション定義（create_post, schedule_post,
 * list_posts, list_accounts 等）をテンプレートとして保持する。
 *
 * design.md セクション 1.6 (skills 配布フォーマット) に従い、
 *  - name は `<namespace>.<verb>` 形式
 *  - parameters は最小限の JSON Schema
 *  - permissions / requiredCapabilities は core の Permission / capability キーと整合
 * を満たす。
 *
 * generateSkillPackage は ProviderRegistry から取得した capability を見て、
 * このテンプレート集合のうち capability を満たすものを採用する。
 */
import type { Permission } from "@sns-agent/core";
import type { SkillAction, SkillJsonSchema, SkillPlatform } from "../manifest/types.js";

// ───────────────────────────────────────────
// 共通スキーマ片
// ───────────────────────────────────────────

const TEXT_PARAM: SkillJsonSchema = {
  type: "string",
  description: "投稿本文",
  minLength: 1,
  maxLength: 5000,
};

const ACCOUNT_NAME_PARAM: SkillJsonSchema = {
  type: "string",
  description: "対象 SNS アカウントの表示名 or ID",
  minLength: 1,
  maxLength: 256,
};

const SCHEDULED_AT_PARAM: SkillJsonSchema = {
  type: "string",
  description: "予約日時 (ISO 8601 文字列, 例: 2026-04-10T12:00:00Z)",
  minLength: 1,
};

const STATUS_FILTER_PARAM: SkillJsonSchema = {
  type: "string",
  description: "投稿ステータスフィルタ",
  enum: ["draft", "scheduled", "published", "failed", "deleted"],
};

const LIMIT_PARAM: SkillJsonSchema = {
  type: "integer",
  description: "最大取得件数",
  minimum: 1,
  maximum: 200,
};

// ───────────────────────────────────────────
// アクションテンプレート定義
// ───────────────────────────────────────────

/**
 * テンプレート定義: 1 つの skill action のひな形 + 必要 capability キー。
 *
 * generateSkillPackage はこのリストを走査し、対象 platform と
 * capability を満たすものを採用する。
 */
export interface SkillActionTemplate {
  /** SkillAction として使う完全な定義 */
  action: SkillAction;
  /**
   * このテンプレートを採用する条件として ProviderCapabilities のどのキーを
   * 評価するか。複数キーは AND 条件 (全て true である必要がある)。
   * 空配列の場合は capability チェックなしで常に採用。
   */
  capabilityKeys: Array<keyof import("@sns-agent/core").ProviderCapabilities>;
  /**
   * 対象プラットフォーム。"common" は全プラットフォーム共通。
   * 配列で複数指定可。
   */
  platforms: SkillPlatform[];
}

/**
 * X / LINE / Instagram で共通の最低限テンプレート集合。
 *
 * - text 投稿系: textPost capability
 * - 予約投稿:    textPost capability (予約は core 側のジョブで実現するため
 *               provider の nativeSchedule capability に依存しない)
 * - 一覧系:       常時 (DB 検索なので capability 不要)
 */
export const BUILTIN_ACTION_TEMPLATES: SkillActionTemplate[] = [
  // ───── アカウント一覧 (全 platform 共通, capability 不要) ─────
  {
    action: {
      name: "list_accounts",
      description: "ワークスペースに接続済みの SNS アカウント一覧を取得する",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      permissions: ["account:read" as Permission],
      requiredCapabilities: [],
      readOnly: true,
    },
    capabilityKeys: [],
    platforms: ["x", "line", "instagram"],
  },

  // ───── 投稿一覧 (全 platform 共通, capability 不要) ─────
  {
    action: {
      name: "list_posts",
      description: "投稿一覧を取得する。status / limit でフィルタできる",
      parameters: {
        type: "object",
        properties: {
          status: STATUS_FILTER_PARAM,
          limit: LIMIT_PARAM,
        },
        required: [],
        additionalProperties: false,
      },
      permissions: ["post:read" as Permission],
      requiredCapabilities: [],
      readOnly: true,
    },
    capabilityKeys: [],
    platforms: ["x", "line", "instagram"],
  },

  // ───── テキスト投稿作成 (textPost capability 必須) ─────
  {
    action: {
      name: "create_post",
      description: "新規テキスト投稿を作成する。publishNow=true なら即時投稿、false なら下書き保存",
      parameters: {
        type: "object",
        properties: {
          accountName: ACCOUNT_NAME_PARAM,
          text: TEXT_PARAM,
          publishNow: {
            type: "boolean",
            description: "true で即時投稿、false で下書き保存 (既定 false)",
          },
        },
        required: ["accountName", "text"],
        additionalProperties: false,
      },
      permissions: ["post:create" as Permission],
      requiredCapabilities: ["textPost"],
      readOnly: false,
    },
    capabilityKeys: ["textPost"],
    platforms: ["x", "line", "instagram"],
  },

  // ───── 予約投稿 (textPost capability 必須) ─────
  {
    action: {
      name: "schedule_post",
      description: "テキスト投稿を指定日時に予約投稿する",
      parameters: {
        type: "object",
        properties: {
          accountName: ACCOUNT_NAME_PARAM,
          text: TEXT_PARAM,
          scheduledAt: SCHEDULED_AT_PARAM,
        },
        required: ["accountName", "text", "scheduledAt"],
        additionalProperties: false,
      },
      permissions: ["schedule:create" as Permission],
      requiredCapabilities: ["textPost"],
      readOnly: false,
    },
    capabilityKeys: ["textPost"],
    platforms: ["x", "line", "instagram"],
  },
];
