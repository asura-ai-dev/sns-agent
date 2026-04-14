/**
 * Task 5004: Chat UI — API client.
 *
 * Talks to the Agent Gateway (`/api/agent/chat`, `/api/agent/execute`,
 * `/api/agent/history`) from client components and falls back to a local
 * demo transcript when the API process is offline. The UI then shows a
 * "wire offline" banner (see ChatContainer) and the operator can still
 * explore the interface without a running backend.
 *
 * Streaming strategy:
 *   The current API returns non-streaming JSON. To keep the UX aligned
 *   with the spec (AC-16 chat driving LLM + preview), `streamChatMessage`
 *   fetches the JSON response with fetch() and then iterates through the
 *   returned content character-by-character on a short interval to give
 *   the caller a ReadableStream-like "typing" experience. When real SSE
 *   lands in the API (v1.5), swap the body of `streamChatMessage` with a
 *   `ReadableStream` reader over `text/event-stream` — the caller signature
 *   is stable.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

// ───────────────────────────────────────────
// Wire types (mirror apps/api/src/routes/agent.ts response shape)
// ───────────────────────────────────────────

export type ExecutionMode = "read-only" | "draft" | "approval-required" | "direct-execute";

export interface SkillIntent {
  actionName: string;
  packageName: string;
  args: Record<string, unknown>;
}

export interface SkillPreview {
  actionName: string;
  packageName: string;
  description?: string | null;
  preview?: Record<string, unknown> | string | null;
  requiredPermissions: string[];
  missingPermissions: string[];
  argumentErrors?: unknown;
  mode: ExecutionMode;
  allowed: boolean;
  blockedReason?: string | null;
}

export interface ChatTextResponse {
  kind: "text";
  conversationId: string;
  content: string;
}

export interface ChatPreviewResponse {
  kind: "preview";
  conversationId: string;
  content: string;
  intent: SkillIntent;
  preview: SkillPreview;
}

export type ChatResponse = ChatTextResponse | ChatPreviewResponse;

export interface ExecuteResponse {
  outcome: {
    actionName: string;
    packageName: string;
    result: unknown;
    mode: ExecutionMode;
  };
  auditLogId?: string | null;
  conversationId?: string | null;
}

export interface HistoryEntry {
  id: string;
  action: string;
  conversationId: string | null;
  inputSummary: string | null;
  resultSummary: string | null;
  createdAt: string;
}

// ───────────────────────────────────────────
// Result envelopes
// ───────────────────────────────────────────

export interface ApiFailure {
  ok: false;
  error: { code?: string; message: string; status?: number };
}

export interface ApiSuccess<T> {
  ok: true;
  value: T;
  isFallback?: boolean;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

async function parseError(res: Response): Promise<ApiFailure> {
  let code: string | undefined;
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    /* ignore */
  }
  return { ok: false, error: { code, message, status: res.status } };
}

// ───────────────────────────────────────────
// Streaming chat
// ───────────────────────────────────────────

export interface StreamCallbacks {
  /** Called once the conversationId is known (possibly before any content). */
  onOpen?: (conversationId: string) => void;
  /** Called with incremental content chunks as they arrive. */
  onToken: (token: string) => void;
  /** Called once with the complete resolved response. */
  onComplete: (response: ChatResponse, opts: { fallback: boolean }) => void;
  /** Called on any error that aborted the stream. */
  onError?: (error: { message: string; code?: string }) => void;
}

/** Turn a final string into chunks, simulating token streaming. */
async function emitAsTokens(
  content: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Break by roughly 2–4 character segments to feel like teletype without
  // being so slow that real use is painful.
  const chunks: string[] = [];
  let i = 0;
  while (i < content.length) {
    const step = Math.min(3, content.length - i);
    chunks.push(content.slice(i, i + step));
    i += step;
  }
  for (const chunk of chunks) {
    if (signal?.aborted) return;
    onToken(chunk);
    // ~14ms per chunk -> ~70 chunks/sec. Feels alive but not sluggish.
    await new Promise((r) => setTimeout(r, 14));
  }
}

/**
 * Send a chat message and stream the response to the caller.
 *
 * The current backend is non-streaming JSON; this function fetches the
 * full response and then emits it as simulated tokens so the UI can render
 * a live typing effect. When the API is unreachable, a canned demo reply
 * is emitted (useful for local dev and design review).
 */
export async function streamChatMessage(
  params: {
    message: string;
    conversationId: string | null;
    mode?: ExecutionMode;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${API_BASE}/api/agent/chat`;
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: params.message,
        conversationId: params.conversationId,
        mode: params.mode ?? "approval-required",
      }),
      signal,
    });
    if (!res.ok) {
      const fail = await parseError(res);
      // Degrade to fallback so the UI stays usable for designers.
      return await streamFallback(params, callbacks, signal, fail.error.message);
    }
    const body = (await res.json()) as { data: ChatResponse };
    const data = body.data;
    callbacks.onOpen?.(data.conversationId);
    await emitAsTokens(data.content, callbacks.onToken, signal);
    callbacks.onComplete(data, { fallback: false });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      callbacks.onError?.({ message: "aborted", code: "ABORTED" });
      return;
    }
    const msg = err instanceof Error ? err.message : "wire down";
    await streamFallback(params, callbacks, signal, msg);
  }
}

/** Build a deterministic fallback reply used when the API is unreachable. */
function buildFallbackReply(message: string): ChatResponse {
  const lower = message.toLowerCase();
  const asksPost =
    lower.includes("投稿") ||
    lower.includes("post") ||
    lower.includes("tweet") ||
    lower.includes("流して") ||
    lower.includes("公開");

  if (asksPost) {
    const snippet = message.replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      kind: "preview",
      conversationId: "demo-wire-001",
      content: "承知しました。draft を組版しました。プレビューを確認のうえ、承認してください。",
      intent: {
        actionName: "post.create",
        packageName: "sns-agent.demo",
        args: {
          platform: "x",
          contentText: snippet || "今日の号外: SNS Agent チャット特派員より配信。",
        },
      },
      preview: {
        actionName: "post.create",
        packageName: "sns-agent.demo",
        description: "X に新規投稿を起案します（demo fallback）",
        preview: {
          platform: "x",
          contentText: snippet || "今日の号外: SNS Agent チャット特派員より配信。",
          estimatedCharCount: (snippet || "今日の号外: SNS Agent チャット特派員より配信。").length,
        },
        requiredPermissions: ["post:write"],
        missingPermissions: [],
        argumentErrors: null,
        mode: "approval-required",
        allowed: true,
        blockedReason: null,
      },
    };
  }

  return {
    kind: "text",
    conversationId: "demo-wire-001",
    content:
      "（wire offline — demo reply）\n承りました。本番 API に接続すると、LLM 経由で投稿案やスキル提案を返します。左ペインの『new dispatch』で新規電報を開けます。",
  };
}

async function streamFallback(
  params: { message: string },
  callbacks: StreamCallbacks,
  signal: AbortSignal | undefined,
  reason: string,
): Promise<void> {
  const data = buildFallbackReply(params.message);
  callbacks.onOpen?.(data.conversationId);
  callbacks.onError?.({ message: `offline: ${reason}`, code: "FALLBACK" });
  await emitAsTokens(data.content, callbacks.onToken, signal);
  callbacks.onComplete(data, { fallback: true });
}

// ───────────────────────────────────────────
// Skill execute
// ───────────────────────────────────────────

function executeFallback(params: {
  intent: SkillIntent;
  conversationId: string | null;
  mode?: ExecutionMode;
}): ApiResult<ExecuteResponse> {
  return {
    ok: true,
    isFallback: true,
    value: {
      outcome: {
        actionName: params.intent.actionName,
        packageName: params.intent.packageName,
        mode: params.mode ?? "approval-required",
        result: {
          status: "deferred",
          message:
            "wire offline — no backend to execute against. The proof sheet would be sent to press once the API is online.",
        },
      },
      auditLogId: null,
      conversationId: params.conversationId,
    },
  };
}

export async function executeSkillAction(params: {
  intent: SkillIntent;
  conversationId: string | null;
  mode?: ExecutionMode;
}): Promise<ApiResult<ExecuteResponse>> {
  try {
    const res = await fetch(`${API_BASE}/api/agent/execute`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionName: params.intent.actionName,
        packageName: params.intent.packageName,
        args: params.intent.args,
        conversationId: params.conversationId,
        mode: params.mode ?? "approval-required",
      }),
    });
    if (!res.ok) {
      // 404 / 5xx typically means the Agent Gateway is not mounted (local
      // dev without apps/api running). Degrade gracefully so the operator
      // can still walk through the approval flow during design review.
      if (res.status === 404 || res.status >= 500) {
        return executeFallback(params);
      }
      return await parseError(res);
    }
    const body = (await res.json()) as { data: ExecuteResponse };
    return { ok: true, value: body.data };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { message: "aborted", code: "ABORTED" } };
    }
    return executeFallback(params);
  }
}

// ───────────────────────────────────────────
// History
// ───────────────────────────────────────────

export async function fetchHistory(params?: {
  conversationId?: string;
  limit?: number;
}): Promise<ApiResult<HistoryEntry[]>> {
  const qs = new URLSearchParams();
  if (params?.conversationId) qs.set("conversationId", params.conversationId);
  qs.set("limit", String(params?.limit ?? 100));
  try {
    const res = await fetch(`${API_BASE}/api/agent/history?${qs.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 404 || res.status >= 500) {
        return { ok: true, isFallback: true, value: buildDemoHistory() };
      }
      return await parseError(res);
    }
    const body = (await res.json()) as { data: HistoryEntry[] };
    return { ok: true, value: body.data ?? [] };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { message: "aborted", code: "ABORTED" } };
    }
    return { ok: true, isFallback: true, value: buildDemoHistory() };
  }
}

function buildDemoHistory(): HistoryEntry[] {
  const now = Date.now();
  const hour = 3_600_000;
  return [
    {
      id: "demo-h-1",
      action: "agent.chat",
      conversationId: "demo-wire-001",
      inputSummary: "今朝の X 向けリリース原稿を一本書いてほしい",
      resultSummary: "draft を組版し、プレビューを提示しました",
      createdAt: new Date(now - 2 * hour).toISOString(),
    },
    {
      id: "demo-h-2",
      action: "agent.execute",
      conversationId: "demo-wire-001",
      inputSummary: "post.create を承認",
      resultSummary: "deferred (wire offline)",
      createdAt: new Date(now - 2 * hour + 60_000).toISOString(),
    },
    {
      id: "demo-h-3",
      action: "agent.chat",
      conversationId: "demo-wire-002",
      inputSummary: "LINE の予約投稿の状態を教えて",
      resultSummary: "3 件 pending、1 件 retrying と応答",
      createdAt: new Date(now - 26 * hour).toISOString(),
    },
    {
      id: "demo-h-4",
      action: "agent.chat",
      conversationId: "demo-wire-003",
      inputSummary: "Instagram の先週の使用量を要約",
      resultSummary: "総コール 142 件 / cost $0.48 を要約",
      createdAt: new Date(now - 3 * 24 * hour).toISOString(),
    },
  ];
}

// ───────────────────────────────────────────
// Conversation grouping helpers (client-side)
// ───────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  lastActionAt: string;
  messageCount: number;
  lastSnippet: string;
}

export function groupHistoryByConversation(entries: HistoryEntry[]): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>();
  for (const entry of entries) {
    const cid = entry.conversationId ?? "loose-" + entry.id;
    const existing = map.get(cid);
    const snippet = entry.inputSummary ?? entry.resultSummary ?? "(no content)";
    if (!existing) {
      map.set(cid, {
        id: cid,
        title: snippet.slice(0, 48),
        lastActionAt: entry.createdAt,
        messageCount: 1,
        lastSnippet: snippet,
      });
    } else {
      existing.messageCount += 1;
      if (new Date(entry.createdAt) > new Date(existing.lastActionAt)) {
        existing.lastActionAt = entry.createdAt;
        existing.lastSnippet = snippet;
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastActionAt).getTime() - new Date(a.lastActionAt).getTime(),
  );
}
