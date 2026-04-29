import { createElement } from "react";
import type { UsageReportEntry } from "@sns-agent/sdk";

interface UsageDimensionTablesProps {
  endpointEntries: UsageReportEntry[];
  gateEntries: UsageReportEntry[];
  isLoading?: boolean;
  endpointErrorMessage?: string | null;
  gateErrorMessage?: string | null;
}

type RowKind = "endpoint" | "gate";

function valueFor(entry: UsageReportEntry, kind: RowKind): string {
  if (kind === "endpoint") return entry.endpoint ?? "unknown";
  return entry.gateId ?? "unassigned";
}

function labelFor(entry: UsageReportEntry, kind: RowKind): string {
  if (kind === "endpoint") return entry.endpoint ?? "unknown";
  return entry.feature
    ? `${entry.gateId ?? "unassigned"} · ${entry.feature}`
    : (entry.gateId ?? "unassigned");
}

function rowsFor(entries: UsageReportEntry[], kind: RowKind): UsageReportEntry[] {
  return entries
    .filter((entry) => entry.platform === "x" && valueFor(entry, kind) !== "unknown")
    .sort((a, b) => (b.estimatedCost ?? 0) - (a.estimatedCost ?? 0));
}

function invalidCountFor(entries: UsageReportEntry[], kind: RowKind): number {
  return entries.filter((entry) => {
    if (entry.platform !== "x") return false;
    if (kind === "endpoint") return !entry.endpoint;
    return !entry.gateId;
  }).length;
}

function Notice({ tone, children }: { tone: "warning" | "error"; children?: string }) {
  const toneClass =
    tone === "error"
      ? "border-error/40 bg-error/5 text-error/85"
      : "border-warning/40 bg-warning/5 text-[#7a4b00]";
  return createElement(
    "div",
    {
      className: `mb-2 rounded-sm border border-dashed px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${toneClass}`,
    },
    children,
  );
}

function DimensionTable({
  title,
  kind,
  entries,
  isLoading,
  errorMessage,
}: {
  title: string;
  kind: RowKind;
  entries: UsageReportEntry[];
  isLoading: boolean;
  errorMessage?: string | null;
}) {
  const rows = rowsFor(entries, kind);
  const invalidCount = invalidCountFor(entries, kind);

  return createElement(
    "div",
    null,
    createElement(
      "h4",
      { className: "mb-2 font-display text-base font-semibold text-base-content" },
      title,
    ),
    errorMessage ? createElement(Notice, { tone: "error" }, errorMessage) : null,
    invalidCount > 0
      ? createElement(
          Notice,
          { tone: "warning" },
          `dimension data incomplete · ${invalidCount} row${invalidCount === 1 ? "" : "s"}`,
        )
      : null,
    createElement(
      "div",
      { className: "overflow-x-auto" },
      createElement(
        "table",
        { className: "w-full text-sm" },
        createElement(
          "thead",
          null,
          createElement(
            "tr",
            {
              className:
                "border-b border-base-content/35 font-mono text-[9px] uppercase tracking-[0.18em] text-base-content/55",
            },
            createElement(
              "th",
              { className: "py-2 pr-3 text-left font-medium" },
              kind === "endpoint" ? "endpoint" : "gate",
            ),
            createElement(
              "th",
              { className: "py-2 pr-3 text-right font-medium tabular-nums" },
              "requests",
            ),
            createElement(
              "th",
              { className: "py-2 pr-3 text-right font-medium tabular-nums" },
              "success",
            ),
            createElement(
              "th",
              { className: "py-2 pr-3 text-right font-medium tabular-nums" },
              "failure",
            ),
            createElement(
              "th",
              { className: "py-2 pr-3 text-right font-medium tabular-nums" },
              "rate",
            ),
            createElement(
              "th",
              { className: "py-2 pr-3 text-right font-medium tabular-nums" },
              "cost (usd)",
            ),
          ),
        ),
        createElement(
          "tbody",
          null,
          isLoading
            ? createElement(
                "tr",
                null,
                createElement(
                  "td",
                  {
                    colSpan: 6,
                    className:
                      "py-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45",
                  },
                  "loading x usage dimensions",
                ),
              )
            : rows.length === 0
              ? createElement(
                  "tr",
                  null,
                  createElement(
                    "td",
                    {
                      colSpan: 6,
                      className:
                        "py-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/45",
                    },
                    "no x usage rows for this dimension",
                  ),
                )
              : rows.map((entry) =>
                  createElement(
                    "tr",
                    {
                      key: `${entry.period}:${valueFor(entry, kind)}`,
                      className: "border-b border-dashed border-base-content/15",
                    },
                    createElement(
                      "td",
                      { className: "py-2.5 pr-3 font-mono text-xs text-base-content" },
                      labelFor(entry, kind),
                    ),
                    createElement(
                      "td",
                      {
                        className:
                          "py-2.5 pr-3 text-right font-mono tabular-nums text-base-content/85",
                      },
                      entry.requestCount.toLocaleString(),
                    ),
                    createElement(
                      "td",
                      {
                        className: "py-2.5 pr-3 text-right font-mono tabular-nums text-success/80",
                      },
                      entry.successCount.toLocaleString(),
                    ),
                    createElement(
                      "td",
                      { className: "py-2.5 pr-3 text-right font-mono tabular-nums text-error/80" },
                      entry.failureCount.toLocaleString(),
                    ),
                    createElement(
                      "td",
                      {
                        className:
                          "py-2.5 pr-3 text-right font-mono tabular-nums text-base-content/75",
                      },
                      `${(entry.successRate * 100).toFixed(1)}%`,
                    ),
                    createElement(
                      "td",
                      {
                        className:
                          "py-2.5 pr-3 text-right font-display text-base font-semibold tabular-nums text-base-content",
                      },
                      `$${(entry.estimatedCost ?? 0).toFixed(4)}`,
                    ),
                  ),
                ),
        ),
      ),
    ),
  );
}

export function UsageDimensionTables({
  endpointEntries,
  gateEntries,
  isLoading = false,
  endpointErrorMessage = null,
  gateErrorMessage = null,
}: UsageDimensionTablesProps) {
  return createElement(
    "div",
    { className: "grid gap-4 lg:grid-cols-2" },
    createElement(DimensionTable, {
      title: "Endpoint Detail",
      kind: "endpoint",
      entries: endpointEntries,
      isLoading,
      errorMessage: endpointErrorMessage,
    }),
    createElement(DimensionTable, {
      title: "Gate Detail",
      kind: "gate",
      entries: gateEntries,
      isLoading,
      errorMessage: gateErrorMessage,
    }),
  );
}
