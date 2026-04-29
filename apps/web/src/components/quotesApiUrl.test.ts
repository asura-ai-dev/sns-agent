import { describe, expect, it, vi } from "vitest";
import QuotesPage from "../app/(dashboard)/quotes/page";

vi.mock("@/lib/i18n/labels", () => ({
  MASTHEAD_TITLES: { quotes: "Quotes" },
  SECTION_KICKERS: { quotes: "Quotes" },
}));

vi.mock("@/components/settings/PlatformIcon", () => ({
  PlatformIcon: () => null,
}));

const { buildQuotesApiUrl } = QuotesPage as typeof QuotesPage & {
  buildQuotesApiUrl: (path: `/api/${string}`, apiBase?: string) => string;
};

describe("buildQuotesApiUrl", () => {
  it("prepends the public API base when configured", () => {
    expect(buildQuotesApiUrl("/api/quote-tweets?limit=100", "https://api.example.test")).toBe(
      "https://api.example.test/api/quote-tweets?limit=100",
    );
  });

  it("falls back to a relative API URL without a public API base", () => {
    expect(buildQuotesApiUrl("/api/accounts", "")).toBe("/api/accounts");
  });
});
