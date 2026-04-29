import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FollowerSnapshotChart, type FollowerAnalyticsViewModel } from "./FollowerSnapshotChart";

const populated: FollowerAnalyticsViewModel = {
  currentCount: 120,
  delta7Days: 20,
  delta30Days: 40,
  series: [
    { date: "2026-03-30", followerCount: 80, followingCount: 20 },
    { date: "2026-04-22", followerCount: 100, followingCount: 25 },
    { date: "2026-04-29", followerCount: 120, followingCount: 30 },
  ],
};

describe("FollowerSnapshotChart", () => {
  it("renders loading state", () => {
    const html = renderToStaticMarkup(createElement(FollowerSnapshotChart, { state: "loading" }));

    expect(html).toContain("loading follower snapshots");
  });

  it("renders empty state when no snapshots exist", () => {
    const html = renderToStaticMarkup(
      createElement(FollowerSnapshotChart, {
        state: "ready",
        analytics: { currentCount: 0, delta7Days: null, delta30Days: null, series: [] },
      }),
    );

    expect(html).toContain("no follower snapshots");
  });

  it("renders current count, deltas, and populated time series", () => {
    const html = renderToStaticMarkup(
      createElement(FollowerSnapshotChart, { state: "ready", analytics: populated }),
    );

    expect(html).toContain("120");
    expect(html).toContain("+20");
    expect(html).toContain("+40");
    expect(html).toContain("2026-04-29");
    expect(html).toContain("<svg");
  });
});
