/**
 * sns post コマンド
 *
 * - sns post list [--platform <p>] [--status <s>] [--limit <n>] [--json]
 * - sns post create --platform <p> --account <name|id> (--text "..." | --file <path>)
 *                   [--media <path>]... [--quote-post-id <id>] [--thread-segment <text>]...
 *                   [--publish | --at <ISO>] [--json]
 * - sns post show <id> [--json]
 * - sns post delete <id>
 * - sns post publish <id>
 *
 * 全コマンドは SDK の SnsAgentClient.posts リソース経由で API を呼ぶ。
 * エラーは runCommand で一元処理され、終了コード 1 を返す。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type {
  CreatePostInput,
  ListPostsParams,
  MediaAttachment,
  Platform,
  Post,
  PostProviderMetadata,
  SocialAccount,
} from "@sns-agent/sdk";
import { runCommand, type GlobalOptions } from "../context.js";

/** list サブコマンドの列定義 */
const LIST_COLUMNS: Array<[string, string]> = [
  ["ID", "id"],
  ["PLATFORM", "platform"],
  ["STATUS", "status"],
  ["TEXT", "contentText"],
  ["CREATED AT", "createdAt"],
  ["PUBLISHED AT", "publishedAt"],
];

/** 許可プラットフォーム */
const ALLOWED_PLATFORMS = ["x", "line", "instagram"] as const;

/** 親コマンドからグローバルオプションを拾う */
function getGlobalOpts(cmd: Command): GlobalOptions {
  let current: Command | null = cmd;
  while (current) {
    const opts = current.opts() as GlobalOptions;
    if (opts && (opts.json !== undefined || opts.apiUrl || opts.apiKey)) {
      return opts;
    }
    current = current.parent;
  }
  return {};
}

/** 必須文字列オプション */
function requireStr(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw Object.assign(new Error(`--${name} is required`), { code: "VALID_REQUIRED" });
  }
  return value;
}

/** platform バリデーション */
function validatePlatform(value: string): Platform {
  if (!ALLOWED_PLATFORMS.includes(value as Platform)) {
    throw Object.assign(
      new Error(`Invalid --platform '${value}'. Expected one of: ${ALLOWED_PLATFORMS.join(", ")}.`),
      { code: "VALID_PLATFORM" },
    );
  }
  return value as Platform;
}

/** 簡易 UUID 判定 (v4 形式など) */
function looksLikeId(value: string): boolean {
  // ハイフン入り英数字の UUID 風 or 十分長い id 値
  return /^[0-9a-fA-F-]{16,}$/.test(value);
}

/** メディアパスから MediaAttachment を構築する */
async function buildMediaAttachments(paths: string[] | undefined): Promise<MediaAttachment[]> {
  if (!paths || paths.length === 0) return [];
  const results: MediaAttachment[] = [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    // 存在確認 (ファイルがなければエラー)
    try {
      await fs.access(resolved);
    } catch {
      throw Object.assign(new Error(`Media file not found: ${p}`), {
        code: "VALID_MEDIA_NOT_FOUND",
      });
    }
    const ext = path.extname(resolved).toLowerCase().replace(".", "");
    const videoExts = new Set(["mp4", "mov", "webm", "m4v", "avi"]);
    const type: "image" | "video" = videoExts.has(ext) ? "video" : "image";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      m4v: "video/x-m4v",
      avi: "video/x-msvideo",
    };
    const mimeType = mimeMap[ext] ?? (type === "video" ? "video/mp4" : "image/png");
    // ローカルファイルはアップロードエンドポイントがない前提で file:// URL を渡す。
    // API 側がこれを拒否する場合はエラー応答を CLI が整形して返す。
    results.push({ type, url: `file://${resolved}`, mimeType });
  }
  return results;
}

/** --account 値から socialAccountId を解決する。UUID ならそのまま、
 *  それ以外は accounts.list から displayName に一致するものを探す。 */
async function resolveAccountId(
  ctx: { client: { accounts: { list(): Promise<{ data: SocialAccount[] }> } } },
  accountValue: string,
  platform: Platform,
): Promise<string> {
  if (looksLikeId(accountValue)) return accountValue;
  const res = await ctx.client.accounts.list();
  const matches = res.data.filter((a) => a.platform === platform && a.displayName === accountValue);
  if (matches.length === 0) {
    throw Object.assign(
      new Error(
        `No ${platform} account found with name or id '${accountValue}'. ` +
          `Run 'sns accounts list' to see available accounts.`,
      ),
      { code: "VALID_ACCOUNT_NOT_FOUND" },
    );
  }
  if (matches.length > 1) {
    throw Object.assign(
      new Error(
        `Multiple ${platform} accounts found with name '${accountValue}'. ` +
          `Specify an account id instead.`,
      ),
      { code: "VALID_ACCOUNT_AMBIGUOUS" },
    );
  }
  return matches[0].id;
}

/** 数値オプションのパース。NaN / 非正整数は例外 */
function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) {
    throw Object.assign(new Error(`--${name} must be a non-negative integer`), {
      code: "VALID_NUMBER",
    });
  }
  return n;
}

/** ISO 8601 日時の緩めのバリデーション */
function validateIsoDate(value: string, name: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(
      new Error(`--${name} must be a valid ISO 8601 date-time (e.g. 2026-04-12T09:00:00+09:00)`),
      { code: "VALID_DATE" },
    );
  }
  return value;
}

export function registerPostCommand(program: Command): void {
  const post = program.command("post").description("Manage posts (drafts, publish, delete)");

  // ---- list ----
  post
    .command("list")
    .description("List posts")
    .option("--platform <platform>", "Filter by platform (x | line | instagram)")
    .option("--status <status>", "Filter by status (draft | scheduled | published | ...)")
    .option("--limit <n>", "Maximum number of posts to return")
    .action(
      async (subOpts: { platform?: string; status?: string; limit?: string }, cmd: Command) => {
        const globals = getGlobalOpts(cmd);
        await runCommand(globals, async (ctx) => {
          const params: ListPostsParams = {};
          if (subOpts.platform) params.platform = validatePlatform(subOpts.platform);
          if (subOpts.status) params.status = subOpts.status;
          const limit = parsePositiveInt(subOpts.limit, "limit");
          if (limit !== undefined) params.limit = limit;

          const res = await ctx.client.posts.list(params);
          const items: Post[] = res.data;
          ctx.formatter.data(items, {
            title: `Posts (${items.length})`,
            columns: LIST_COLUMNS,
            emptyMessage: "No posts found.",
          });
        });
      },
    );

  // ---- create ----
  post
    .command("create")
    .description("Create a post (draft by default, add --publish or --at for delivery)")
    .option("--platform <platform>", "Target platform (x | line | instagram) (required)")
    .option("--account <name|id>", "SNS account name or id (required)")
    .option("--text <text>", "Post body text")
    .option("--file <path>", "Read post body from a file")
    .option("--media <path>", "Attach media file (repeatable)", (value, previous: string[]) => {
      return previous ? [...previous, value] : [value];
    })
    .option("--quote-post-id <id>", "Quote target tweet/post id (X only)")
    .option(
      "--thread-segment <text>",
      "Append a self-reply segment for thread posting (repeatable, X only)",
      (value, previous: string[]) => {
        return previous ? [...previous, value] : [value];
      },
    )
    .option("--publish", "Publish immediately (omit for draft)")
    .option("--at <iso>", "Schedule for future publishing (ISO 8601)")
    .action(
      async (
        subOpts: {
          platform?: string;
          account?: string;
          text?: string;
          file?: string;
          media?: string[];
          quotePostId?: string;
          threadSegment?: string[];
          publish?: boolean;
          at?: string;
        },
        cmd: Command,
      ) => {
        const globals = getGlobalOpts(cmd);
        await runCommand(globals, async (ctx) => {
          const platform = validatePlatform(requireStr(subOpts.platform, "platform"));
          const accountValue = requireStr(subOpts.account, "account");
          const quotePostId = subOpts.quotePostId?.trim() ?? "";
          const threadSegments =
            subOpts.threadSegment?.map((segment) => segment.trim()).filter((segment) => segment) ??
            [];

          // text / file / quote のいずれかは必要。quote-only 投稿も許可する。
          if (!subOpts.text && !subOpts.file && !quotePostId) {
            throw Object.assign(new Error("--text, --file, or --quote-post-id is required"), {
              code: "VALID_REQUIRED",
            });
          }
          if (subOpts.text && subOpts.file) {
            throw Object.assign(new Error("--text and --file are mutually exclusive"), {
              code: "VALID_CONFLICT",
            });
          }
          if (subOpts.publish && subOpts.at) {
            throw Object.assign(new Error("--publish and --at are mutually exclusive"), {
              code: "VALID_CONFLICT",
            });
          }
          if (platform !== "x" && (quotePostId || threadSegments.length > 0)) {
            throw Object.assign(
              new Error("--quote-post-id and --thread-segment are supported only for platform x"),
              { code: "VALID_PLATFORM_OPTION" },
            );
          }
          if (subOpts.threadSegment && threadSegments.length !== subOpts.threadSegment.length) {
            throw Object.assign(new Error("Empty --thread-segment is not allowed"), {
              code: "VALID_THREAD_SEGMENT",
            });
          }

          let contentText: string | undefined = subOpts.text;
          if (subOpts.file) {
            try {
              contentText = await fs.readFile(path.resolve(subOpts.file), "utf-8");
            } catch {
              throw Object.assign(new Error(`Failed to read --file '${subOpts.file}'`), {
                code: "VALID_FILE_READ",
              });
            }
          }

          const socialAccountId = await resolveAccountId(ctx, accountValue, platform);
          const contentMedia = await buildMediaAttachments(subOpts.media);
          const scheduledAt = subOpts.at ? validateIsoDate(subOpts.at, "at") : undefined;
          const providerMetadata: PostProviderMetadata | null =
            quotePostId || threadSegments.length > 0
              ? {
                  x: {
                    quotePostId: quotePostId || null,
                    threadPosts:
                      threadSegments.length > 0
                        ? threadSegments.map((contentText) => ({ contentText }))
                        : null,
                  },
                }
              : null;

          const input: CreatePostInput = {
            socialAccountId,
            platform,
          };
          if (contentText !== undefined) input.contentText = contentText;
          if (contentMedia.length > 0) input.contentMedia = contentMedia;
          if (providerMetadata) input.providerMetadata = providerMetadata;
          if (subOpts.publish) input.publish = true;

          const postRes = await ctx.client.posts.create(input);

          if (scheduledAt) {
            const scheduleRes = await ctx.client.schedules.create({
              postId: postRes.data.id,
              scheduledAt,
            });
            ctx.formatter.data(
              {
                post: postRes.data,
                schedule: scheduleRes.data,
              },
              { title: "Post scheduled" },
            );
            return;
          }

          ctx.formatter.data(postRes.data, {
            title: subOpts.publish ? "Post published" : "Draft created",
          });
        });
      },
    );

  // ---- show ----
  post
    .command("show <id>")
    .description("Show post details")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.posts.get(id);
        ctx.formatter.data(res.data, { title: `Post ${id}` });
      });
    });

  // ---- delete ----
  post
    .command("delete <id>")
    .description("Delete a post")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.posts.delete(id);
        ctx.formatter.data(res.data, { title: `Deleted post ${id}` });
      });
    });

  // ---- publish ----
  post
    .command("publish <id>")
    .description("Publish a draft post immediately")
    .action(async (id: string, _subOpts: Record<string, unknown>, cmd: Command) => {
      const globals = getGlobalOpts(cmd);
      await runCommand(globals, async (ctx) => {
        const res = await ctx.client.posts.publish(id);
        ctx.formatter.data(res.data, { title: `Published post ${id}` });
      });
    });
}
