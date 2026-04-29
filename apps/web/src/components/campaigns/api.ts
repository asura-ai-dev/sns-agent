import type { ApiFailure, ApiResult } from "../posts/api";
import type { MediaAttachment, PostProviderMetadata, PostSocialAccount } from "../posts/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function parseError(res: Response): Promise<ApiFailure> {
  let code: string | undefined;
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    // ignore parse failure
  }
  return { ok: false, error: { code, message, status: res.status } };
}

function networkFailure(err: unknown): ApiFailure {
  const message = err instanceof Error ? err.message : "ネットワークに接続できませんでした";
  return { ok: false, error: { message, code: "NETWORK_ERROR" } };
}

export type CampaignMode = "draft" | "publish" | "schedule";

export interface CreateCampaignInput {
  socialAccountId: string;
  name: string;
  mode: CampaignMode;
  scheduledAt?: string | null;
  post: {
    contentText: string;
    contentMedia?: MediaAttachment[] | null;
    providerMetadata?: PostProviderMetadata | null;
  };
  conditions: {
    requireLike: boolean;
    requireRepost: boolean;
    requireFollow: boolean;
  };
  actionType: "mention_post" | "dm" | "verify_only";
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
}

export interface CampaignCreateResponse {
  id: string;
  mode: CampaignMode;
  post: {
    id: string;
    status: string;
    contentText: string | null;
    platformPostId: string | null;
    updatedAt: string;
  };
  gate: {
    id: string;
    name: string;
    status: "active" | "paused";
    conditions: CreateCampaignInput["conditions"] | null;
    triggerPostId: string | null;
    lineHarnessUrl: string | null;
    lineHarnessTag: string | null;
    lineHarnessScenario: string | null;
    updatedAt: string;
  };
  schedule: {
    id: string;
    status: string;
    scheduledAt: string;
  } | null;
  verifyUrl: string;
}

export async function createCampaignApi(
  input: CreateCampaignInput,
): Promise<ApiResult<CampaignCreateResponse>> {
  try {
    const res = await fetch(`${API_BASE}/api/campaigns`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok && res.status !== 201) return await parseError(res);
    const body = (await res.json()) as { data: CampaignCreateResponse };
    return { ok: true, value: body.data };
  } catch (err) {
    return networkFailure(err);
  }
}

export type { PostSocialAccount };
