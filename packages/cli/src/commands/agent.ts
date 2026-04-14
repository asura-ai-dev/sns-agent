/**
 * sns agent コマンド
 *
 * - sns agent chat "明日9時に投稿して"
 * - sns agent chat "明日9時に投稿して" --execute
 *
 * CLI から Agent Gateway に自然言語メッセージを送り、
 * dry-run preview を確認したうえで、必要なら非対話で execute まで進める。
 */

import { Command } from "commander";
import type {
  AgentChatResponse,
  AgentExecutionMode,
  AgentExecuteResponse,
  AgentSkillPreview,
} from "@sns-agent/sdk";
import { runCommand, type CommandContext, type GlobalOptions } from "../context.js";

const ALLOWED_MODES = ["read-only", "draft", "approval-required", "direct-execute"] as const;

interface AgentExecutionSummary {
  attempted: boolean;
  executed: boolean;
  status?: "executed" | "blocked" | "no-action";
  reason?: string;
  response?: AgentExecuteResponse;
}

function getGlobalOpts(cmd: Command): GlobalOptions {
  let current: Command | null = cmd;
  while (current) {
    const opts = current.opts() as GlobalOptions;
    if (opts && (opts.json !== undefined || opts.apiUrl || opts.apiKey)) {
      return opts;
    }
    current = current.parent;
  }
  return {};
}

function validateMode(value: string | undefined): AgentExecutionMode {
  const mode = value ?? "approval-required";
  if (!ALLOWED_MODES.includes(mode as AgentExecutionMode)) {
    throw Object.assign(
      new Error(`--mode must be one of: ${ALLOWED_MODES.join(", ")}`),
      { code: "VALID_MODE" },
    );
  }
  return mode as AgentExecutionMode;
}

function isExecutablePreview(preview: AgentSkillPreview): boolean {
  return (
    preview.allowed &&
    preview.missingPermissions.length === 0 &&
    preview.argumentErrors.length === 0
  );
}

function summarizeBlockedReason(preview: AgentSkillPreview): string {
  if (preview.blockedReason && preview.blockedReason.trim() !== "") {
    return preview.blockedReason;
  }
  if (preview.argumentErrors.length > 0) {
    return `Argument errors: ${preview.argumentErrors.join("; ")}`;
  }
  if (preview.missingPermissions.length > 0) {
    return `Missing permissions: ${preview.missingPermissions.join(", ")}`;
  }
  return "Preview was blocked, so execution was not attempted.";
}

function toPreviewPayload(
  payload: AgentSkillPreview["preview"],
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") {
    return { preview: payload };
  }
  return payload;
}

function printHumanReadableResult(
  ctx: CommandContext,
  params: {
    message: string;
    requestedMode: AgentExecutionMode;
    response: AgentChatResponse;
    execution: AgentExecutionSummary;
  },
): void {
  const { message, requestedMode, response, execution } = params;

  ctx.formatter.data(
    {
      message,
      requestedMode,
      conversationId: response.conversationId ?? "-",
      responseKind: response.kind,
    },
    { title: "受付内容" },
  );

  ctx.formatter.data({ reply: response.content }, { title: "AI の返答" });

  if (response.kind === "preview") {
    ctx.formatter.data(
      {
        actionName: response.intent.actionName,
        packageName: response.intent.packageName,
        mode: response.preview.mode,
        allowed: response.preview.allowed,
        requiredPermissions:
          response.preview.requiredPermissions.length > 0
            ? response.preview.requiredPermissions.join(", ")
            : "none",
        missingPermissions:
          response.preview.missingPermissions.length > 0
            ? response.preview.missingPermissions.join(", ")
            : "none",
        argumentErrors:
          response.preview.argumentErrors.length > 0
            ? response.preview.argumentErrors.join("; ")
            : "none",
        blockedReason: response.preview.blockedReason ?? "-",
      },
      { title: "実行プレビュー" },
    );

    const payload = toPreviewPayload(response.preview.preview);
    if (payload) {
      ctx.formatter.data(payload, { title: "予定される内容" });
    }
  }

  if (execution.attempted) {
    if (execution.executed && execution.response) {
      ctx.formatter.data(
        {
          status: execution.status,
          actionName: execution.response.outcome.actionName,
          packageName: execution.response.outcome.packageName,
          mode: execution.response.outcome.mode,
          auditLogId: execution.response.auditLogId ?? "-",
          conversationId: execution.response.conversationId ?? response.conversationId ?? "-",
          result: execution.response.outcome.result,
        },
        { title: "実行結果" },
      );
      return;
    }

    ctx.formatter.data(
      {
        status: execution.status ?? "blocked",
        reason: execution.reason ?? "-",
      },
      { title: "実行結果" },
    );
  }
}

export function registerAgentCommand(program: Command): void {
  const agent = program.command("agent").description("Operate the AI assistant from CLI");

  agent
    .command("chat <message...>")
    .description("Send a natural-language request to the AI operator")
    .option(
      "--mode <mode>",
      "Execution mode (read-only | draft | approval-required | direct-execute)",
      "approval-required",
    )
    .option("--conversation <id>", "Reuse an existing conversation id")
    .option(
      "--execute",
      "If the agent returns an actionable preview, execute it immediately without an extra prompt",
    )
    .action(
      async (
        messageParts: string[],
        subOpts: {
          mode?: string;
          conversation?: string;
          execute?: boolean;
        },
        cmd: Command,
      ) => {
        const globals = getGlobalOpts(cmd);
        await runCommand(globals, async (ctx) => {
          const message = messageParts.join(" ").trim();
          if (message === "") {
            throw Object.assign(new Error("message is required"), {
              code: "VALID_REQUIRED",
            });
          }

          const requestedMode = validateMode(subOpts.mode);
          const chatRes = await ctx.client.agent.chat({
            message,
            conversationId: subOpts.conversation ?? null,
            mode: requestedMode,
          });
          const response = chatRes.data;

          let execution: AgentExecutionSummary = {
            attempted: Boolean(subOpts.execute),
            executed: false,
          };

          if (subOpts.execute) {
            if (response.kind !== "preview") {
              execution = {
                attempted: true,
                executed: false,
                status: "no-action",
                reason: "The AI returned text only, so there was no action to execute.",
              };
              process.exitCode = 1;
            } else if (!isExecutablePreview(response.preview)) {
              execution = {
                attempted: true,
                executed: false,
                status: "blocked",
                reason: summarizeBlockedReason(response.preview),
              };
              process.exitCode = 1;
            } else {
              const executeRes = await ctx.client.agent.execute({
                actionName: response.intent.actionName,
                packageName: response.intent.packageName,
                args: response.intent.args,
                conversationId: response.conversationId,
                mode: response.preview.mode,
              });
              execution = {
                attempted: true,
                executed: true,
                status: "executed",
                response: executeRes.data,
              };
            }
          }

          if (ctx.json) {
            ctx.formatter.data({
              message,
              requestedMode,
              conversationId: response.conversationId,
              response,
              execution: execution.executed
                ? {
                    attempted: true,
                    executed: true,
                    status: execution.status,
                    response: execution.response,
                  }
                : {
                    attempted: execution.attempted,
                    executed: false,
                    status: execution.status ?? null,
                    reason: execution.reason ?? null,
                  },
            });
            return;
          }

          printHumanReadableResult(ctx, {
            message,
            requestedMode,
            response,
            execution,
          });
        });
      },
    );
}
