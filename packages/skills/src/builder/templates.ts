/**
 * Skill Action ビルトインテンプレート (Task 5003 / P3-1)
 *
 * X 向けチャット操作の最小セットを中心に、manifest 駆動で skill action を
 * 宣言するテンプレート群を保持する。
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

const POST_STATUS_FILTER_PARAM: SkillJsonSchema = {
  type: "string",
  description: "投稿ステータスフィルタ",
  enum: ["draft", "scheduled", "publishing", "published", "failed", "deleted"],
};

const SCHEDULE_STATUS_FILTER_PARAM: SkillJsonSchema = {
  type: "string",
  description: "予約ジョブのステータスフィルタ",
  enum: ["pending", "locked", "running", "succeeded", "failed", "retrying"],
};

const INBOX_STATUS_FILTER_PARAM: SkillJsonSchema = {
  type: "string",
  description: "受信スレッドの状態フィルタ",
  enum: ["open", "closed", "archived"],
};

const LIMIT_PARAM: SkillJsonSchema = {
  type: "integer",
  description: "最大取得件数",
  minimum: 1,
  maximum: 200,
};

const OFFSET_PARAM: SkillJsonSchema = {
  type: "integer",
  description: "取得開始位置",
  minimum: 0,
  maximum: 10000,
};

const DATE_TIME_PARAM: SkillJsonSchema = {
  type: "string",
  description: "ISO 8601 形式の日時",
  minLength: 1,
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
 * X 向けチャット操作でまず必要になる最小テンプレート集合。
 *
 * - post.create   : X に新規投稿を作る
 * - post.schedule : X に予約投稿を作る
 * - post.list     : X 投稿一覧を見る
 * - schedule.list : X の予約一覧を見る
 * - inbox.list    : X の受信スレッド一覧を見る
 *
 * 投稿/予約作成は textPost capability を前提にし、
 * 一覧系は DB 検索のため capability 不要で採用できる。
 */
export const BUILTIN_ACTION_TEMPLATES: SkillActionTemplate[] = [
  // ───── 投稿一覧 (DB 検索のため capability 不要) ─────
  {
    action: {
      name: "post.list",
      description: "X の投稿一覧を取得する。status / limit で絞り込める",
      parameters: {
        type: "object",
        properties: {
          status: POST_STATUS_FILTER_PARAM,
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
      name: "post.create",
      description:
        "X に新規テキスト投稿を作成する。publishNow=true なら即時投稿、false なら下書き保存",
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
      name: "post.schedule",
      description: "X のテキスト投稿を指定日時に予約投稿する",
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

  // ───── 予約一覧 (DB 検索のため capability 不要) ─────
  {
    action: {
      name: "schedule.list",
      description: "X の予約一覧を取得する。status / from / to / limit で絞り込める",
      parameters: {
        type: "object",
        properties: {
          status: SCHEDULE_STATUS_FILTER_PARAM,
          from: DATE_TIME_PARAM,
          to: DATE_TIME_PARAM,
          limit: LIMIT_PARAM,
        },
        required: [],
        additionalProperties: false,
      },
      permissions: ["schedule:read" as Permission],
      requiredCapabilities: [],
      readOnly: true,
    },
    capabilityKeys: [],
    platforms: ["x", "line", "instagram"],
  },

  // ───── 受信一覧 (Phase 2 完了後に X で使う read-only skill) ─────
  {
    action: {
      name: "inbox.list",
      description: "X の受信スレッド一覧を取得する。status / limit / offset で絞り込める",
      parameters: {
        type: "object",
        properties: {
          status: INBOX_STATUS_FILTER_PARAM,
          limit: LIMIT_PARAM,
          offset: OFFSET_PARAM,
        },
        required: [],
        additionalProperties: false,
      },
      permissions: ["inbox:read" as Permission],
      requiredCapabilities: [],
      readOnly: true,
    },
    capabilityKeys: [],
    platforms: ["x"],
  },
];
