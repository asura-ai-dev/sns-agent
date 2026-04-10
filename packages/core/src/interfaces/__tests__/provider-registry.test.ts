/**
 * ProviderRegistry のテスト
 *
 * Task 2003: register / get / getAll の基本動作。
 */
import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../provider-registry.js";
import type { SocialProvider } from "../social-provider.js";

function stubProvider(platform: "x" | "line" | "instagram"): SocialProvider {
  return {
    platform,
    getCapabilities: () => ({
      textPost: true,
      imagePost: false,
      videoPost: false,
      threadPost: false,
      directMessage: false,
      commentReply: false,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({
      success: true,
      platformPostId: "1",
      publishedAt: new Date(),
    }),
    deletePost: async () => ({ success: true }),
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by platform", () => {
    const registry = new ProviderRegistry();
    const x = stubProvider("x");
    registry.register(x);

    expect(registry.get("x")).toBe(x);
    expect(registry.get("line")).toBeUndefined();
    expect(registry.size()).toBe(1);
  });

  it("overwrites the provider if the same platform is registered twice", () => {
    const registry = new ProviderRegistry();
    const a = stubProvider("x");
    const b = stubProvider("x");
    registry.register(a);
    registry.register(b);

    expect(registry.get("x")).toBe(b);
    expect(registry.size()).toBe(1);
  });

  it("returns all registered providers as a Map compatible with AccountUsecaseDeps", () => {
    const registry = new ProviderRegistry();
    const x = stubProvider("x");
    const line = stubProvider("line");
    registry.register(x);
    registry.register(line);

    const all = registry.getAll();
    expect(all.size).toBe(2);
    expect(all.get("x")).toBe(x);
    expect(all.get("line")).toBe(line);
  });
});
