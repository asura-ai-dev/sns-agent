/**
 * アカウント管理ユースケースのテスト
 *
 * Task 2002: listAccounts, getAccount, disconnectAccount, checkTokenExpiry,
 * initiateConnection, handleOAuthCallback, refreshAccountToken のテスト。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SocialAccount } from "../../domain/entities.js";
import type { AccountRepository } from "../../interfaces/repositories.js";
import type {
  SocialProvider,
  ConnectAccountResult,
  RefreshResult,
} from "../../interfaces/social-provider.js";
import type { AccountUsecaseDeps } from "../account.js";
import {
  listAccounts,
  getAccount,
  disconnectAccount,
  checkTokenExpiry,
  initiateConnection,
  handleOAuthCallback,
  refreshAccountToken,
} from "../account.js";
import { encrypt, decrypt } from "../../domain/crypto.js";

// ───────────────────────────────────────────
// テスト用モック
// ───────────────────────────────────────────

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createMockAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Test Account",
    externalAccountId: "ext-123",
    credentialsEncrypted: encrypt('{"access_token":"tok"}', TEST_ENCRYPTION_KEY),
    tokenExpiresAt: new Date("2027-01-01"),
    status: "active",
    capabilities: {
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: false,
      directMessage: true,
      commentReply: false,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function createMockRepo(accounts: SocialAccount[]): AccountRepository {
  const store = new Map(accounts.map((a) => [a.id, { ...a }]));

  return {
    findById: async (id) => {
      const a = store.get(id);
      return a ? { ...a } : null;
    },
    findByWorkspace: async (workspaceId) =>
      [...store.values()].filter((a) => a.workspaceId === workspaceId),
    create: async (data) => {
      const id = `acc-${store.size + 1}`;
      const now = new Date();
      const account: SocialAccount = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };
      store.set(id, account);
      return account;
    },
    update: async (id, data) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Not found: ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

function createMockProvider(): SocialProvider {
  return {
    platform: "x" as const,
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: false,
      directMessage: true,
      commentReply: false,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async (input) => {
      if (input.authorizationCode) {
        // コールバック処理: アカウント情報を返す
        return {
          account: {
            externalAccountId: "ext-new",
            displayName: "New Account",
            credentialsEncrypted: encrypt('{"access_token":"new-tok"}', TEST_ENCRYPTION_KEY),
            tokenExpiresAt: new Date("2027-06-01"),
            capabilities: {
              textPost: true,
              imagePost: true,
              videoPost: false,
              threadPost: false,
              directMessage: true,
              commentReply: false,
              broadcast: false,
              nativeSchedule: false,
              usageApi: false,
            },
          },
        } satisfies ConnectAccountResult;
      }
      // 初回呼び出し: 認可 URL を返す
      return {
        authorizationUrl: `https://twitter.com/oauth/authorize?state=${encodeURIComponent(input.state ?? "")}`,
      } satisfies ConnectAccountResult;
    },
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({ success: true, platformPostId: "p-1", publishedAt: new Date() }),
    deletePost: async () => ({ success: true }),
    refreshToken: async (_accountId): Promise<RefreshResult> => ({
      success: true,
      credentialsEncrypted: encrypt('{"access_token":"refreshed"}', TEST_ENCRYPTION_KEY),
      tokenExpiresAt: new Date("2027-12-01"),
    }),
  };
}

function createDeps(accounts: SocialAccount[] = [], withProvider = true): AccountUsecaseDeps {
  const providers = new Map<"x" | "line" | "instagram", SocialProvider>();
  if (withProvider) {
    providers.set("x", createMockProvider());
  }

  return {
    accountRepo: createMockRepo(accounts),
    providers,
    encryptionKey: TEST_ENCRYPTION_KEY,
    callbackBaseUrl: "http://localhost:3001/api/accounts/callback",
  };
}

// ───────────────────────────────────────────
// テスト
// ───────────────────────────────────────────

describe("listAccounts", () => {
  it("ワークスペースのアカウント一覧を返す（トークンなし）", async () => {
    const deps = createDeps([createMockAccount()]);
    const result = await listAccounts(deps, "ws-1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc-1");
    expect(result[0].displayName).toBe("Test Account");
    // credentialsEncrypted が含まれていないことを確認
    expect((result[0] as Record<string, unknown>).credentialsEncrypted).toBeUndefined();
  });

  it("別のワークスペースのアカウントは返さない", async () => {
    const deps = createDeps([createMockAccount({ workspaceId: "ws-other" })]);
    const result = await listAccounts(deps, "ws-1");
    expect(result).toHaveLength(0);
  });
});

describe("getAccount", () => {
  it("存在するアカウントの詳細を返す", async () => {
    const deps = createDeps([createMockAccount()]);
    const result = await getAccount(deps, "acc-1");

    expect(result.id).toBe("acc-1");
    expect(result.platform).toBe("x");
  });

  it("存在しないアカウントで NotFoundError を投げる", async () => {
    const deps = createDeps([]);
    await expect(getAccount(deps, "nonexistent")).rejects.toThrow("SocialAccount not found");
  });
});

describe("disconnectAccount", () => {
  it("アカウントの status を revoked に変更する", async () => {
    const account = createMockAccount();
    const deps = createDeps([account]);

    await disconnectAccount(deps, "acc-1");

    const updated = await deps.accountRepo.findById("acc-1");
    expect(updated?.status).toBe("revoked");
  });

  it("存在しないアカウントで NotFoundError を投げる", async () => {
    const deps = createDeps([]);
    await expect(disconnectAccount(deps, "nonexistent")).rejects.toThrow("not found");
  });
});

describe("checkTokenExpiry", () => {
  it("期限切れ間近のアカウントを返す", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3日後
    const deps = createDeps([
      createMockAccount({ id: "acc-expiring", tokenExpiresAt: soon }),
      createMockAccount({ id: "acc-ok", tokenExpiresAt: new Date("2027-01-01") }),
    ]);

    const result = await checkTokenExpiry(deps, "ws-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc-expiring");
    expect(result[0].tokenExpiryWarning).toBe(true);
  });

  it("expired/error ステータスのアカウントも返す", async () => {
    const deps = createDeps([
      createMockAccount({ id: "acc-expired", status: "expired", tokenExpiresAt: null }),
    ]);

    const result = await checkTokenExpiry(deps, "ws-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc-expired");
  });
});

describe("initiateConnection", () => {
  it("OAuth 認可 URL を返す", async () => {
    const deps = createDeps([], true);
    const result = await initiateConnection(deps, "ws-1", "x");

    expect(result.authUrl).toContain("https://twitter.com/oauth/authorize");
  });

  it("サポートされていない platform で ValidationError を投げる", async () => {
    const deps = createDeps([], false);
    await expect(initiateConnection(deps, "ws-1", "x")).rejects.toThrow("Unsupported platform");
  });
});

describe("handleOAuthCallback", () => {
  it("コールバックを処理しアカウントを作成する", async () => {
    const deps = createDeps([], true);

    // まず initiateConnection で state を取得
    const { authUrl } = await initiateConnection(deps, "ws-1", "x");
    const stateParam = new URL(authUrl).searchParams.get("state")!;

    // コールバック処理
    const result = await handleOAuthCallback(deps, "auth-code-123", stateParam);

    expect(result.displayName).toBe("New Account");
    expect(result.platform).toBe("x");
    expect(result.status).toBe("active");
    // トークンが含まれていないことを確認
    expect((result as Record<string, unknown>).credentialsEncrypted).toBeUndefined();
  });

  it("不正な state で ValidationError を投げる", async () => {
    const deps = createDeps([], true);
    await expect(handleOAuthCallback(deps, "code", "invalid-state")).rejects.toThrow(
      "Invalid OAuth state",
    );
  });
});

describe("refreshAccountToken", () => {
  it("トークンをリフレッシュしてアカウントを更新する", async () => {
    const deps = createDeps([createMockAccount()], true);
    const result = await refreshAccountToken(deps, "acc-1");

    expect(result.status).toBe("active");
    expect(result.tokenExpiresAt).toEqual(new Date("2027-12-01"));
  });

  it("存在しないアカウントで NotFoundError を投げる", async () => {
    const deps = createDeps([], true);
    await expect(refreshAccountToken(deps, "nonexistent")).rejects.toThrow("not found");
  });

  it("provider がない場合 ProviderError を投げる", async () => {
    const deps = createDeps([createMockAccount()], false);
    await expect(refreshAccountToken(deps, "acc-1")).rejects.toThrow("No provider available");
  });
});

describe("tokenExpiryWarning フラグ", () => {
  it("期限切れ間近のアカウントに warning フラグが付く", async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const deps = createDeps([createMockAccount({ tokenExpiresAt: soon })]);
    const result = await getAccount(deps, "acc-1");
    expect(result.tokenExpiryWarning).toBe(true);
  });

  it("期限が十分先のアカウントには warning フラグが付かない", async () => {
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const deps = createDeps([createMockAccount({ tokenExpiresAt: far })]);
    const result = await getAccount(deps, "acc-1");
    expect(result.tokenExpiryWarning).toBe(false);
  });

  it("tokenExpiresAt が null のアカウントには warning フラグが付かない", async () => {
    const deps = createDeps([createMockAccount({ tokenExpiresAt: null })]);
    const result = await getAccount(deps, "acc-1");
    expect(result.tokenExpiryWarning).toBe(false);
  });
});
