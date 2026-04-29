import {
  XParityPageShell,
  type XParityShellMetric,
  type XParityShellRow,
} from "./XParityPageShell";
import type { FetchResult } from "../../lib/api";

export interface XStepMessageDto {
  id: string;
  stepIndex: number;
  delaySeconds: number;
  actionType: "dm" | "mention_post";
  contentText: string;
}

export interface XStepEnrollmentDto {
  id: string;
  status: "active" | "cancelled" | "completed";
  currentStepIndex: number;
  externalUserId: string;
  username: string | null;
  nextStepAt: string | null;
}

export interface XStepSequenceDto {
  id: string;
  name: string;
  socialAccountId: string;
  status: "active" | "paused";
  deliveryBackoffUntil: string | null;
  messages: XStepMessageDto[];
  enrollments: XStepEnrollmentDto[];
  updatedAt: string;
}

function stateFor(result: FetchResult<XStepSequenceDto[]>) {
  if (!result.ok && result.isFallback) return "error";
  return result.data.length > 0 ? "populated" : "empty";
}

function delayLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function buildMetrics(sequences: XStepSequenceDto[]): XParityShellMetric[] {
  const active = sequences.filter((sequence) => sequence.status === "active").length;
  const enrollments = sequences.flatMap((sequence) => sequence.enrollments);
  return [
    { label: "active", value: String(active), detail: "running sequences" },
    { label: "paused", value: String(sequences.length - active), detail: "draft controls" },
    {
      label: "enrolled",
      value: String(enrollments.filter((enrollment) => enrollment.status === "active").length),
      detail: "active enrollments",
    },
    {
      label: "steps",
      value: String(sequences.reduce((sum, sequence) => sum + sequence.messages.length, 0)),
      detail: "configured messages",
    },
  ];
}

function buildRows(sequences: XStepSequenceDto[]): XParityShellRow[] {
  return sequences.slice(0, 12).map((sequence) => {
    const activeEnrollments = sequence.enrollments.filter(
      (enrollment) => enrollment.status === "active",
    ).length;
    const actions = Array.from(new Set(sequence.messages.map((message) => message.actionType)));
    return {
      id: sequence.id,
      eyebrow: `${sequence.status} / ${sequence.messages.length} steps`,
      title: sequence.name,
      detail: `${actions.join(" + ")} sequence for account ${sequence.socialAccountId.slice(
        0,
        8,
      )} / updated ${sequence.updatedAt}`,
      metrics: [
        {
          label: "active enrollments",
          value: String(activeEnrollments),
          detail: `${sequence.enrollments.length} total`,
        },
        {
          label: "cadence",
          value: sequence.messages.map((message) => delayLabel(message.delaySeconds)).join(" / "),
          detail: "step delays",
        },
        {
          label: "backoff",
          value: sequence.deliveryBackoffUntil ? "held" : "clear",
          detail: sequence.deliveryBackoffUntil ?? "stealth controls ready",
        },
      ],
    };
  });
}

export function SequenceDashboardView({ result }: { result: FetchResult<XStepSequenceDto[]> }) {
  const sequences = result.data;
  return (
    <XParityPageShell
      state={stateFor(result)}
      kicker="X Harness"
      title="Step Sequences"
      description="X step sequence desk for delayed mention and DM delivery after gate enrollment."
      emptyTitle="No step sequences yet"
      emptyDescription="Create a sequence through the API to schedule delayed X mention or DM follow-ups."
      errorMessage={result.errorMessage}
      retryHref="/sequences"
      metrics={buildMetrics(sequences)}
      rows={buildRows(sequences)}
      footerNote="x harness parity / sequence desk"
    />
  );
}
