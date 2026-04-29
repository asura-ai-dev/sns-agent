import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignWizardView, type CampaignWizardSnapshot } from "./CampaignWizard";

const campaign: CampaignWizardSnapshot = {
  id: "gate-1",
  name: "Launch reward campaign",
  mode: "draft",
  postStatus: "draft",
  gateStatus: "paused",
  postText: "Reply to this launch post for the LINE reward.",
  conditions: {
    requireLike: true,
    requireRepost: false,
    requireFollow: true,
  },
  lineHarness: {
    url: "https://line-harness.example/campaigns/launch",
    tag: "launch",
    scenario: "reward-a",
  },
  verifyUrl: "/api/engagement-gates/gate-1/verify",
  updatedAt: "2026-04-29T00:00:00.000Z",
};

describe("CampaignWizardView", () => {
  it("renders preview and validation states for a draft campaign", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignWizardView, {
        state: "ready",
        campaigns: [campaign],
      }),
    );

    expect(html).toContain("Campaign Desk");
    expect(html).toContain("Preview");
    expect(html).toContain("Validation");
    expect(html).toContain("Launch reward campaign");
    expect(html).toContain("like");
    expect(html).toContain("follow");
    expect(html).toContain("LINE handoff");
    expect(html).toContain("draft");
    expect(html).toContain("publish or schedule");
  });

  it("renders loading, empty, and error states without nested shell cards", () => {
    const loading = renderToStaticMarkup(
      createElement(CampaignWizardView, {
        state: "loading",
        campaigns: [],
      }),
    );
    const empty = renderToStaticMarkup(
      createElement(CampaignWizardView, {
        state: "empty",
        campaigns: [],
      }),
    );
    const error = renderToStaticMarkup(
      createElement(CampaignWizardView, {
        state: "error",
        campaigns: [],
        errorMessage: "campaign fetch failed: HTTP 500",
      }),
    );

    expect(loading).toContain("loading campaign wizard");
    expect(empty).toContain("No campaign drafts yet");
    expect(error).toContain("campaign fetch failed: HTTP 500");
    expect(loading).toContain('data-campaign-wizard-layout="flat"');
    expect(empty).toContain('data-campaign-wizard-layout="flat"');
    expect(error).toContain('data-campaign-wizard-layout="flat"');
  });
});
