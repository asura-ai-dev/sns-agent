import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowClockwise,
  ArrowRight,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react/dist/ssr";

export type XParityShellState = "loading" | "empty" | "error" | "populated";

export interface XParityShellMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface XParityShellRow {
  id: string;
  eyebrow: string;
  title: string;
  detail?: string;
  href?: string;
  metrics?: XParityShellMetric[];
}

export interface XParityPageShellProps {
  state: XParityShellState;
  kicker: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription?: string;
  errorMessage?: string;
  retryHref?: string;
  primaryAction?: {
    label: string;
    href: string;
  };
  metrics?: XParityShellMetric[];
  rows?: XParityShellRow[];
  footerNote?: string;
}

function metricStrip(metrics: XParityShellMetric[]): ReactNode {
  if (metrics.length === 0) return null;

  return createElement(
    "section",
    {
      "aria-label": "X parity summary",
      className:
        "grid overflow-hidden rounded-box border border-base-300 bg-base-100 sm:grid-cols-2 xl:grid-cols-4",
    },
    metrics.map((metric) =>
      createElement(
        "div",
        {
          key: metric.label,
          className:
            "border-b border-dashed border-base-300 px-5 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0",
        },
        createElement(
          "div",
          {
            className:
              "font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45",
          },
          metric.label,
        ),
        createElement(
          "div",
          {
            className:
              "mt-1 font-display text-4xl font-semibold leading-none tabular-nums text-base-content",
            style: { fontFamily: "'Fraunces', serif" },
          },
          metric.value,
        ),
        metric.detail
          ? createElement(
              "div",
              {
                className:
                  "mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-base-content/45",
              },
              metric.detail,
            )
          : null,
      ),
    ),
  );
}

function loadingState(): ReactNode {
  return createElement(
    "section",
    { className: "rounded-box border border-dashed border-base-300 bg-base-100 px-5 py-8" },
    createElement(
      "div",
      {
        className:
          "flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/50",
      },
      createElement(CircleNotch, { size: 16, weight: "bold", className: "animate-spin" }),
      "loading x parity dashboard",
    ),
    createElement(
      "div",
      { className: "mt-5 grid gap-3 md:grid-cols-3" },
      [0, 1, 2].map((idx) =>
        createElement("div", {
          key: idx,
          className: "h-28 rounded-sm border border-base-300 bg-base-200/50",
        }),
      ),
    ),
  );
}

function emptyState({
  title,
  description,
  primaryAction,
}: {
  title: string;
  description?: string;
  primaryAction?: XParityPageShellProps["primaryAction"];
}): ReactNode {
  return createElement(
    "section",
    { className: "rounded-box border border-dashed border-base-300 bg-base-100 px-5 py-8" },
    createElement(
      "div",
      { className: "max-w-2xl" },
      createElement(
        "div",
        { className: "font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/40" },
        "no records filed",
      ),
      createElement(
        "h2",
        {
          className: "mt-2 font-display text-2xl font-semibold leading-tight text-base-content",
          style: { fontFamily: "'Fraunces', serif" },
        },
        title,
      ),
      description
        ? createElement(
            "p",
            { className: "mt-2 text-sm leading-6 text-base-content/60" },
            description,
          )
        : null,
      primaryAction
        ? createElement(
            Link,
            {
              href: primaryAction.href,
              className:
                "mt-5 inline-flex min-h-10 items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content",
            },
            primaryAction.label,
            createElement(ArrowRight, { size: 14, weight: "bold" }),
          )
        : null,
    ),
  );
}

function errorState({ message, retryHref }: { message?: string; retryHref?: string }): ReactNode {
  return createElement(
    "section",
    { className: "rounded-box border border-warning/50 bg-warning/10 px-5 py-5 text-[#7a4b00]" },
    createElement(
      "div",
      { className: "flex items-start gap-3" },
      createElement(Warning, { size: 18, weight: "bold", className: "mt-0.5 shrink-0" }),
      createElement(
        "div",
        { className: "min-w-0" },
        createElement(
          "div",
          { className: "font-mono text-[10px] font-semibold uppercase tracking-[0.18em]" },
          "wire offline",
        ),
        createElement(
          "p",
          { className: "mt-1 break-words text-sm leading-6 text-[#7a4b00]/80" },
          message ?? "The X parity data source could not be reached.",
        ),
        retryHref
          ? createElement(
              Link,
              {
                href: retryHref,
                className:
                  "mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7a4b00] underline underline-offset-4",
              },
              createElement(ArrowClockwise, { size: 12, weight: "bold" }),
              "retry",
            )
          : null,
      ),
    ),
  );
}

function rowList(rows: XParityShellRow[]): ReactNode {
  return createElement(
    "section",
    { "aria-label": "X parity records", className: "space-y-3" },
    rows.map((row) => {
      const body = createElement(
        "article",
        {
          className:
            "rounded-box border border-base-300 bg-base-100 px-5 py-4 transition-colors hover:border-base-content/30",
        },
        createElement(
          "div",
          { className: "flex flex-wrap items-start justify-between gap-3" },
          createElement(
            "div",
            { className: "min-w-0" },
            createElement(
              "div",
              {
                className:
                  "font-mono text-[10px] uppercase tracking-[0.18em] text-base-content/45",
              },
              row.eyebrow,
            ),
            createElement(
              "h2",
              {
                className:
                  "mt-1 break-words font-display text-xl font-semibold leading-tight text-base-content",
                style: { fontFamily: "'Fraunces', serif" },
              },
              row.title,
            ),
            row.detail
              ? createElement(
                  "p",
                  { className: "mt-1 break-words text-sm leading-6 text-base-content/60" },
                  row.detail,
                )
              : null,
          ),
          row.href
            ? createElement(ArrowRight, {
                size: 16,
                weight: "bold",
                className: "mt-1 shrink-0",
              })
            : null,
        ),
        row.metrics && row.metrics.length > 0
          ? createElement(
              "dl",
              { className: "mt-4 grid gap-3 sm:grid-cols-3" },
              row.metrics.map((metric) =>
                createElement(
                  "div",
                  {
                    key: metric.label,
                    className: "border-t border-dashed border-base-300 pt-2",
                  },
                  createElement(
                    "dt",
                    {
                      className:
                        "font-mono text-[9px] uppercase tracking-[0.16em] text-base-content/40",
                    },
                    metric.label,
                  ),
                  createElement(
                    "dd",
                    {
                      className:
                        "mt-1 text-sm font-semibold tabular-nums text-base-content",
                    },
                    metric.value,
                  ),
                  metric.detail
                    ? createElement(
                        "dd",
                        { className: "mt-0.5 text-xs text-base-content/50" },
                        metric.detail,
                      )
                    : null,
                ),
              ),
            )
          : null,
      );

      return row.href
        ? createElement(Link, { key: row.id, href: row.href, className: "block" }, body)
        : createElement("div", { key: row.id }, body);
    }),
  );
}

export function XParityPageShell({
  state,
  kicker,
  title,
  description,
  emptyTitle,
  emptyDescription,
  errorMessage,
  retryHref,
  primaryAction,
  metrics = [],
  rows = [],
  footerNote,
}: XParityPageShellProps) {
  return createElement(
    "main",
    {
      className: "mx-auto max-w-[1440px] space-y-6",
      "data-x-parity-shell": "flat",
    },
    createElement(
      "header",
      { className: "border-b border-base-300 pb-5" },
      createElement(
        "div",
        { className: "font-mono text-[10px] uppercase tracking-[0.22em] text-base-content/45" },
        kicker,
      ),
      createElement(
        "div",
        { className: "mt-2 flex flex-wrap items-end justify-between gap-4" },
        createElement(
          "div",
          { className: "min-w-0" },
          createElement(
            "h1",
            {
              className:
                "break-words font-display text-4xl font-semibold leading-tight text-base-content",
              style: { fontFamily: "'Fraunces', serif" },
            },
            title,
          ),
          createElement(
            "p",
            { className: "mt-2 max-w-3xl text-sm leading-6 text-base-content/65" },
            description,
          ),
        ),
        primaryAction
          ? createElement(
              Link,
              {
                href: primaryAction.href,
                className:
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-field border border-base-300 bg-base-100 px-3 py-2 text-xs font-medium text-base-content/70 transition-colors hover:border-base-content/30 hover:text-base-content",
              },
              primaryAction.label,
              createElement(ArrowRight, { size: 14, weight: "bold" }),
            )
          : null,
      ),
    ),
    state === "loading" ? loadingState() : null,
    state === "error" ? errorState({ message: errorMessage, retryHref }) : null,
    state === "empty"
      ? emptyState({ title: emptyTitle, description: emptyDescription, primaryAction })
      : null,
    state === "populated"
      ? createElement(Fragment, null, metricStrip(metrics), rowList(rows))
      : null,
    footerNote
      ? createElement(
          "footer",
          {
            className:
              "border-t border-dashed border-base-content/20 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-base-content/35",
          },
          footerNote,
        )
      : null,
  );
}
