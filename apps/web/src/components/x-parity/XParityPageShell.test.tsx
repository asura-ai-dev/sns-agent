import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NAV_LABELS } from "../../lib/i18n/labels";
import { XParityPageShell, type XParityShellRow } from "./XParityPageShell";

const rows: XParityShellRow[] = [
  {
    id: "gate-1",
    title: "Launch gate",
    eyebrow: "active",
    detail: "Reply trigger with LINE handoff",
    metrics: [
      { label: "deliveries", value: "24" },
      { label: "backoff", value: "clear" },
    ],
  },
];

describe("X parity dashboard shell", () => {
  it("adds the X Harness parity routes to dashboard navigation", () => {
    const hrefs = NAV_LABELS.map((item) => item.href);

    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/gates",
        "/campaigns",
        "/followers",
        "/tags",
        "/analytics",
        "/quotes",
        "/sequences",
      ]),
    );
  });

  it("renders a loading state without rows", () => {
    const html = renderToStaticMarkup(
      createElement(XParityPageShell, {
        state: "loading",
        kicker: "X Harness",
        title: "Engagement gates",
        description: "Secret reply automations.",
        emptyTitle: "No gates yet",
      }),
    );

    expect(html).toContain("loading x parity dashboard");
    expect(html).not.toContain("Launch gate");
  });

  it("renders an empty state with the supplied guidance", () => {
    const html = renderToStaticMarkup(
      createElement(XParityPageShell, {
        state: "empty",
        kicker: "X Harness",
        title: "Followers",
        description: "X follower CRM.",
        emptyTitle: "No followers synced",
        emptyDescription: "Sync an active X account to fill this ledger.",
      }),
    );

    expect(html).toContain("No followers synced");
    expect(html).toContain("Sync an active X account");
  });

  it("renders an error state with a retry target", () => {
    const html = renderToStaticMarkup(
      createElement(XParityPageShell, {
        state: "error",
        kicker: "X Harness",
        title: "Tags",
        description: "Segments for follower workflows.",
        emptyTitle: "No tags yet",
        errorMessage: "tags fetch failed: HTTP 500",
        retryHref: "/tags",
      }),
    );

    expect(html).toContain("wire offline");
    expect(html).toContain("tags fetch failed: HTTP 500");
    expect(html).toContain("href=\"/tags\"");
  });

  it("renders populated metrics and rows using a flat shell layout", () => {
    const html = renderToStaticMarkup(
      createElement(XParityPageShell, {
        state: "populated",
        kicker: "X Harness",
        title: "Engagement gates",
        description: "Secret reply automations.",
        emptyTitle: "No gates yet",
        metrics: [
          { label: "active", value: "3", detail: "running gates" },
          { label: "paused", value: "1", detail: "needs review" },
        ],
        rows,
      }),
    );

    expect(html).toContain("active");
    expect(html).toContain("running gates");
    expect(html).toContain("Launch gate");
    expect(html).toContain("Reply trigger with LINE handoff");
    expect(html).toContain("data-x-parity-shell=\"flat\"");
  });
});
