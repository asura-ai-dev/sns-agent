import { ValidationError } from "../errors/domain-error.js";
import type {
  LlmProviderCredential,
  LlmProviderCredentialProvider,
  LlmProviderCredentialStatus,
} from "../domain/entities.js";
import type { LlmProviderCredentialRepository } from "../interfaces/repositories.js";

export type LlmProviderConnectionStatus = "missing" | "connected" | "expired" | "reauth_required";

export interface LlmProviderCredentialsDeps {
  credentialRepo: LlmProviderCredentialRepository;
}

export interface LlmProviderStatusResult {
  provider: LlmProviderCredentialProvider;
  status: LlmProviderConnectionStatus;
  connected: boolean;
  requiresReauth: boolean;
  reason: string;
  expiresAt: Date | null;
  scopes: string[] | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: Date | null;
}

export interface SaveLlmProviderCredentialInput {
  workspaceId: string;
  provider: LlmProviderCredentialProvider;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  expiresAt?: Date | null;
  status?: LlmProviderCredentialStatus;
  scopes?: string[] | null;
  subject?: string | null;
  metadata?: Record<string, unknown> | null;
}

function assertProvider(provider: string): asserts provider is LlmProviderCredentialProvider {
  if (provider !== "openai-codex") {
    throw new ValidationError(`Unsupported LLM provider credentials provider: ${provider}`, {
      provider,
    });
  }
}

function assertWorkspace(workspaceId: string): void {
  if (!workspaceId.trim()) {
    throw new ValidationError("workspaceId is required");
  }
}

function assertEncryptedToken(value: string): void {
  if (!value.trim()) {
    throw new ValidationError("accessTokenEncrypted is required");
  }
}

function toStatusResult(
  provider: LlmProviderCredentialProvider,
  credential: LlmProviderCredential | null,
  now: Date,
): LlmProviderStatusResult {
  if (!credential) {
    return {
      provider,
      status: "missing",
      connected: false,
      requiresReauth: false,
      reason: "not_connected",
      expiresAt: null,
      scopes: null,
      subject: null,
      metadata: null,
      updatedAt: null,
    };
  }

  const expiredByTime =
    credential.expiresAt !== null && credential.expiresAt.getTime() <= now.getTime();
  let status: LlmProviderConnectionStatus;
  let reason: string;

  if (credential.status === "reauth_required") {
    status = "reauth_required";
    reason = "provider_requires_reauth";
  } else if (credential.status === "expired" || expiredByTime) {
    status = "expired";
    reason = expiredByTime ? "token_expired" : "marked_expired";
  } else {
    status = "connected";
    reason = "credential_available";
  }

  return {
    provider,
    status,
    connected: status === "connected",
    requiresReauth: status === "expired" || status === "reauth_required",
    reason,
    expiresAt: credential.expiresAt,
    scopes: credential.scopes,
    subject: credential.subject,
    metadata: credential.metadata,
    updatedAt: credential.updatedAt,
  };
}

export async function getLlmProviderCredential(
  deps: LlmProviderCredentialsDeps,
  input: { workspaceId: string; provider: string },
): Promise<LlmProviderCredential | null> {
  assertWorkspace(input.workspaceId);
  assertProvider(input.provider);
  return deps.credentialRepo.findByWorkspaceAndProvider(input.workspaceId, input.provider);
}

export async function getLlmProviderStatus(
  deps: LlmProviderCredentialsDeps,
  input: { workspaceId: string; provider: string; now?: Date },
): Promise<LlmProviderStatusResult> {
  const credential = await getLlmProviderCredential(deps, input);
  assertProvider(input.provider);
  return toStatusResult(input.provider, credential, input.now ?? new Date());
}

export async function saveLlmProviderCredential(
  deps: LlmProviderCredentialsDeps,
  input: SaveLlmProviderCredentialInput,
): Promise<LlmProviderCredential> {
  assertWorkspace(input.workspaceId);
  assertProvider(input.provider);
  assertEncryptedToken(input.accessTokenEncrypted);

  return deps.credentialRepo.upsert({
    workspaceId: input.workspaceId,
    provider: input.provider,
    status: input.status ?? "connected",
    accessTokenEncrypted: input.accessTokenEncrypted,
    refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
    expiresAt: input.expiresAt ?? null,
    scopes: input.scopes ?? null,
    subject: input.subject ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function disconnectLlmProvider(
  deps: LlmProviderCredentialsDeps,
  input: { workspaceId: string; provider: string },
): Promise<LlmProviderStatusResult> {
  assertWorkspace(input.workspaceId);
  assertProvider(input.provider);
  await deps.credentialRepo.deleteByWorkspaceAndProvider(input.workspaceId, input.provider);
  return toStatusResult(input.provider, null, new Date());
}
