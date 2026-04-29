import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageDimensionTables } from "./UsageDimensionTables";
import type { UsageReportEntry } from "@sns-agent/sdk";

describe("UsageDimensionTables", () => {
  it("renders endpoint and gate level X usage rows", () => {
    const endpointEntries: UsageReportEntry[] = [
      {
        period: "2026-04-29",
        platform: "x",
        endpoint: "engagement.gate.deliver",
        requestCount: 3,
        successCount: 2,
        failureCount: 1,
        successRate: 2 / 3,
        estimatedCost: 0.006,
      },
    ];
    const gateEntries: UsageReportEntry[] = [
      {
        period: "2026-04-29",
        platform: "x",
        gateId: "gate-1",
        feature: "engagement_gate",
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        successRate: 1,
        estimatedCost: 0.004,
      },
    ];

    const html = renderToStaticMarkup(
      createElement(UsageDimensionTables, { endpointEntries, gateEntries }),
    );

    expect(html).toContain("Endpoint Detail");
    expect(html).toContain("Gate Detail");
    expect(html).toContain("engagement.gate.deliver");
    expect(html).toContain("gate-1");
    expect(html).toContain("engagement_gate");
    expect(html).toContain("66.7%");
    expect(html).toContain("$0.0060");
  });

  it("renders loading, error, and validation states for X dimension tables", () => {
    const html = renderToStaticMarkup(
      createElement(UsageDimensionTables, {
        endpointEntries: [
          {
            period: "2026-04-29",
            platform: "x",
            requestCount: 1,
            successCount: 1,
            failureCount: 0,
            successRate: 1,
            estimatedCost: 0.001,
          },
        ],
        gateEntries: [],
        isLoading: true,
        endpointErrorMessage: "endpoint feed unavailable",
      }),
    );

    expect(html).toContain("loading x usage dimensions");
    expect(html).toContain("endpoint feed unavailable");
    expect(html).toContain("dimension data incomplete");
  });
});
