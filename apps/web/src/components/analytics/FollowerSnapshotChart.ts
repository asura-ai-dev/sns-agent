import { createElement } from "react";

const h = createElement;

export interface FollowerAnalyticsPointViewModel {
  date: string;
  followerCount: number;
  followingCount: number;
}

export interface FollowerAnalyticsViewModel {
  currentCount: number;
  delta7Days: number | null;
  delta30Days: number | null;
  series: FollowerAnalyticsPointViewModel[];
}

export interface FollowerSnapshotChartProps {
  state: "loading" | "ready";
  analytics?: FollowerAnalyticsViewModel;
}

function formatDelta(value: number | null): string {
  if (value === null) return "n/a";
  if (value > 0) return `+${value.toLocaleString("en-US")}`;
  return value.toLocaleString("en-US");
}

function buildPolyline(series: FollowerAnalyticsPointViewModel[]): string {
  if (series.length === 0) return "";
  const max = Math.max(...series.map((point) => point.followerCount), 1);
  const min = Math.min(...series.map((point) => point.followerCount));
  const spread = Math.max(max - min, 1);
  return series
    .map((point, index) => {
      const x = series.length === 1 ? 50 : (index / (series.length - 1)) * 100;
      const y = 88 - ((point.followerCount - min) / spread) * 68;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function LoadingState() {
  return h(
    "section",
    {
      "aria-busy": "true",
      "aria-label": "Follower snapshot analytics",
      className:
        "flex min-h-80 items-center justify-center rounded-sm border border-dashed border-base-content/25 bg-base-200/30",
    },
    h(
      "div",
      {
        className: "font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45",
      },
      "loading follower snapshots",
    ),
  );
}

function EmptyState() {
  return h(
    "section",
    {
      "aria-label": "Follower snapshot analytics",
      className:
        "flex min-h-80 items-center justify-center rounded-sm border border-dashed border-base-content/25 bg-base-200/30 text-center",
    },
    h(
      "div",
      null,
      h(
        "div",
        {
          className: "font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45",
        },
        "no follower snapshots",
      ),
      h(
        "div",
        {
          className: "mt-2 font-display text-lg italic text-base-content/55",
          style: { fontFamily: "'Fraunces', serif" },
        },
        "daily analytics will appear after the next capture",
      ),
    ),
  );
}

function StatBlock(props: { label: string; value: string }) {
  return h(
    "div",
    null,
    h(
      "dt",
      {
        className: "font-mono text-[10px] uppercase tracking-[0.16em] text-base-content/45",
      },
      props.label,
    ),
    h(
      "dd",
      {
        className: "mt-1 font-mono text-sm font-semibold tabular-nums text-base-content",
      },
      props.value,
    ),
  );
}

export function FollowerSnapshotChart({ state, analytics }: FollowerSnapshotChartProps) {
  if (state === "loading") return h(LoadingState);
  if (!analytics || analytics.series.length === 0) return h(EmptyState);

  const points = buildPolyline(analytics.series);
  const latest = analytics.series.at(-1);

  return h(
    "section",
    {
      "aria-label": "Follower snapshot analytics",
      className: "rounded-sm border border-base-300 bg-base-100 p-5",
    },
    h(
      "div",
      { className: "grid gap-4 md:grid-cols-[220px_1fr]" },
      h(
        "div",
        {
          className:
            "border-b border-dashed border-base-300 pb-4 md:border-b-0 md:border-r md:pr-4",
        },
        h(
          "div",
          {
            className: "font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45",
          },
          "current followers",
        ),
        h(
          "div",
          {
            className:
              "mt-2 font-display text-6xl font-semibold leading-none tabular-nums text-base-content",
            style: { fontFamily: "'Fraunces', serif" },
          },
          analytics.currentCount.toLocaleString("en-US"),
        ),
        h(
          "dl",
          { className: "mt-5 grid grid-cols-2 gap-3" },
          h(StatBlock, { label: "7 day", value: formatDelta(analytics.delta7Days) }),
          h(StatBlock, { label: "30 day", value: formatDelta(analytics.delta30Days) }),
        ),
      ),
      h(
        "div",
        null,
        h(
          "div",
          { className: "mb-3 flex items-center justify-between gap-4" },
          h(
            "div",
            {
              className: "font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45",
            },
            "daily snapshot series",
          ),
          latest
            ? h(
                "div",
                {
                  className:
                    "font-mono text-[10px] uppercase tracking-[0.12em] text-base-content/45",
                },
                latest.date,
              )
            : null,
        ),
        h(
          "svg",
          {
            role: "img",
            "aria-label": "Follower count time series",
            viewBox: "0 0 100 100",
            className: "h-64 w-full overflow-visible",
            preserveAspectRatio: "none",
          },
          h("line", {
            x1: "0",
            y1: "88",
            x2: "100",
            y2: "88",
            stroke: "currentColor",
            opacity: "0.18",
          }),
          h("line", {
            x1: "0",
            y1: "20",
            x2: "100",
            y2: "20",
            stroke: "currentColor",
            opacity: "0.1",
          }),
          h("polyline", {
            points,
            fill: "none",
            stroke: "#0f766e",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: "2.5",
            vectorEffect: "non-scaling-stroke",
          }),
          analytics.series.map((point, index) => {
            const [x, y] = points.split(" ")[index]?.split(",") ?? ["0", "88"];
            return h(
              "g",
              { key: point.date },
              h("circle", {
                cx: x,
                cy: y,
                r: "1.7",
                fill: "#0f766e",
                vectorEffect: "non-scaling-stroke",
              }),
              h(
                "title",
                null,
                `${point.date}: ${point.followerCount} followers, ${point.followingCount} following`,
              ),
            );
          }),
        ),
      ),
    ),
  );
}
