import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsageLoadingState } from "./UsageLoadingState";

describe("UsageLoadingState", () => {
  it("renders a route-level loading state for the usage dashboard", () => {
    const html = renderToStaticMarkup(createElement(UsageLoadingState));

    expect(html).toContain("loading usage ledger");
    expect(html).toContain("X Cost Dimensions");
    expect(html).toContain("Budget Consumption");
  });
});
