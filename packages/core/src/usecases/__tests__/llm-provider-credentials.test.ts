import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  LlmProviderCredential,
  LlmProviderCredentialProvider,
} from "../../domain/entities.js";
import type { LlmProviderCredentialRepository } from "../../interfaces/repositories.js";
import {
  disconnectLlmProvider,
  getLlmProviderStatus,
  saveLlmProviderCredential,
  type LlmProviderCredentialsDeps,
} from "../llm-provider-credentials.js";
import { ValidationError } from "../../errors/domain-error.js";

class InMemoryCredentialRepo implements LlmProviderCredentialRepository {
  items: LlmProviderCredential[] = [];

  async findByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<LlmProviderCredential | null> {
    return (
      this.items.find((item) => item.workspaceId === workspaceId && item.provider === provider) ??
      null
    );
  }

  async upsert(
    credential: Omit<LlmProviderCredential, "id" | "createdAt" | "updatedAt">,
  ): Promise<LlmProviderCredential> {
    const existing = await this.findByWorkspaceAndProvider(
      credential.workspaceId,
      credential.provider,
    );
    const now = new Date("2026-04-20T00:00:00Z");
    if (existing) {
      const updated = { ...existing, ...credential, updatedAt: now };
      this.items = this.items.map((item) => (item.id === existing.id ? updated : item));
      return updated;
    }
    const created = {
      ...credential,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(created);
    return created;
  }

  async deleteByWorkspaceAndProvider(
    workspaceId: string,
    provider: LlmProviderCredentialProvider,
  ): Promise<void> {
    this.items = this.items.filter(
      (item) => item.workspaceId !== workspaceId || item.provider !== provider,
    );
  }
}

let repo: InMemoryCredentialRepo;
let deps: LlmProviderCredentialsDeps;

beforeEach(() => {
  repo = new InMemoryCredentialRepo();
  deps = { credentialRepo: repo };
});

describe("LLM provider credential status", () => {
  it("returns missing when no credential exists", async () => {
    const status = await getLlmProviderStatus(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
    });

    expect(status).toMatchObject({
      provider: "openai-codex",
      status: "missing",
      connected: false,
      requiresReauth: false,
      reason: "not_connected",
    });
  });

  it("returns connected for an unexpired encrypted credential", async () => {
    await saveLlmProviderCredential(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      expiresAt: new Date("2026-04-21T00:00:00Z"),
      scopes: ["codex"],
      subject: "user@example.com",
      metadata: { source: "test" },
    });

    const status = await getLlmProviderStatus(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      now: new Date("2026-04-20T00:00:00Z"),
    });

    expect(status.status).toBe("connected");
    expect(status.connected).toBe(true);
    expect(status.requiresReauth).toBe(false);
    expect(status.scopes).toEqual(["codex"]);
    expect(status.subject).toBe("user@example.com");
  });

  it("returns expired when expiresAt is in the past", async () => {
    await saveLlmProviderCredential(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      accessTokenEncrypted: "encrypted-access",
      expiresAt: new Date("2026-04-19T23:59:59Z"),
    });

    const status = await getLlmProviderStatus(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      now: new Date("2026-04-20T00:00:00Z"),
    });

    expect(status.status).toBe("expired");
    expect(status.connected).toBe(false);
    expect(status.requiresReauth).toBe(true);
    expect(status.reason).toBe("token_expired");
  });

  it("returns reauth_required when the credential is marked so", async () => {
    await saveLlmProviderCredential(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      accessTokenEncrypted: "encrypted-access",
      status: "reauth_required",
      expiresAt: new Date("2026-04-21T00:00:00Z"),
    });

    const status = await getLlmProviderStatus(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      now: new Date("2026-04-20T00:00:00Z"),
    });

    expect(status.status).toBe("reauth_required");
    expect(status.requiresReauth).toBe(true);
    expect(status.reason).toBe("provider_requires_reauth");
  });

  it("disconnects by deleting the workspace provider credential", async () => {
    await saveLlmProviderCredential(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
      accessTokenEncrypted: "encrypted-access",
    });

    const status = await disconnectLlmProvider(deps, {
      workspaceId: "ws1",
      provider: "openai-codex",
    });

    expect(status.status).toBe("missing");
    expect(await repo.findByWorkspaceAndProvider("ws1", "openai-codex")).toBeNull();
  });

  it("rejects unsupported credential providers", async () => {
    await expect(
      getLlmProviderStatus(deps, {
        workspaceId: "ws1",
        provider: "openai",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
