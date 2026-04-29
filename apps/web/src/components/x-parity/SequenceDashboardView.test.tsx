import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SequenceDashboardView, type XStepSequenceDto } from "./SequenceDashboardView";

const sequences: XStepSequenceDto[] = [
  {
    id: "seq-1",
    name: "Welcome sequence",
    socialAccountId: "sa-test-x",
    status: "active",
    deliveryBackoffUntil: null,
    messages: [
      { id: "msg-1", stepIndex: 0, delaySeconds: 60, actionType: "dm", contentText: "Welcome" },
      {
        id: "msg-2",
        stepIndex: 1,
        delaySeconds: 3600,
        actionType: "mention_post",
        contentText: "Follow-up",
      },
    ],
    enrollments: [
      {
        id: "enr-1",
        status: "active",
        currentStepIndex: 0,
        externalUserId: "user-1",
        username: "alice",
        nextStepAt: "2026-04-28T00:01:00.000Z",
      },
      {
        id: "enr-2",
        status: "completed",
        currentStepIndex: 2,
        externalUserId: "user-2",
        username: null,
        nextStepAt: null,
      },
    ],
    updatedAt: "2026-04-28T00:00:00.000Z",
  },
];

describe("SequenceDashboardView", () => {
  it("renders loading empty error and populated sequence states", () => {
    expect(
      renderToStaticMarkup(
        createElement(SequenceDashboardView, {
          result: { ok: true, data: [], isFallback: false },
        }),
      ),
    ).toContain("No step sequences yet");

    expect(
      renderToStaticMarkup(
        createElement(SequenceDashboardView, {
          result: {
            ok: false,
            data: [],
            isFallback: true,
            errorMessage: "step sequence fetch failed",
          },
        }),
      ),
    ).toContain("step sequence fetch failed");

    const html = renderToStaticMarkup(
      createElement(SequenceDashboardView, {
        result: { ok: true, data: sequences, isFallback: false },
      }),
    );

    expect(html).toContain("Welcome sequence");
    expect(html).toContain("2 steps");
    expect(html).toContain("active enrollments");
    expect(html).toContain("dm");
    expect(html).toContain("mention_post");
  });
});
