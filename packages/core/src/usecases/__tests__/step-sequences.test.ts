import { describe, expect, it, vi } from "vitest";
import { encrypt } from "../../domain/crypto.js";
import type {
  AccountRepository,
  StepEnrollment,
  StepEnrollmentCreateInput,
  StepEnrollmentRepository,
  StepMessage,
  StepMessageCreateInput,
  StepMessageRepository,
  StepSequence,
  StepSequenceCreateInput,
  StepSequenceRepository,
} from "../../interfaces/repositories.js";
import type { SocialAccount } from "../../domain/entities.js";
import type { SendReplyResult, SocialProvider } from "../../interfaces/social-provider.js";
import {
  createStepSequence,
  enrollStepSequenceUser,
  processDueStepSequenceEnrollments,
  type StepSequenceUsecaseDeps,
} from "../step-sequences.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAINTEXT_CREDS = '{"accessToken":"tok","xUserId":"brand-x"}';

function mockAccount(): SocialAccount {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    platform: "x",
    displayName: "Brand",
    externalAccountId: "brand-x",
    credentialsEncrypted: encrypt(PLAINTEXT_CREDS, TEST_ENCRYPTION_KEY),
    tokenExpiresAt: null,
    status: "active",
    capabilities: null,
    createdAt: new Date("2026-04-28T00:00:00Z"),
    updatedAt: new Date("2026-04-28T00:00:00Z"),
  };
}

function mockAccountRepo(account = mockAccount()): AccountRepository {
  return {
    findById: async (id) => (id === account.id ? account : null),
    findByWorkspace: async () => [account],
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
  };
}

function buildSequence(input: Partial<StepSequence> = {}): StepSequence {
  const now = new Date("2026-04-28T00:00:00Z");
  return {
    id: "seq-1",
    workspaceId: "ws-1",
    socialAccountId: "acc-1",
    platform: "x",
    name: "Launch sequence",
    status: "active",
    stealthConfig: null,
    deliveryBackoffUntil: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function buildMessage(input: Partial<StepMessage> = {}): StepMessage {
  const now = new Date("2026-04-28T00:00:00Z");
  return {
    id: "msg-1",
    workspaceId: "ws-1",
    sequenceId: "seq-1",
    stepIndex: 0,
    delaySeconds: 60,
    actionType: "dm",
    contentText: "First step",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function mockSequenceRepo(initial: StepSequence[] = []): StepSequenceRepository & {
  rows: Map<string, StepSequence>;
} {
  const rows = new Map(initial.map((row) => [row.id, row]));
  let seq = rows.size;
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    findByWorkspace: async (workspaceId, filters = {}) =>
      [...rows.values()].filter(
        (row) =>
          row.workspaceId === workspaceId &&
          (!filters.socialAccountId || row.socialAccountId === filters.socialAccountId) &&
          (!filters.status || row.status === filters.status),
      ),
    create: async (input: StepSequenceCreateInput) => {
      const now = new Date("2026-04-28T00:00:00Z");
      const row = { ...input, id: `seq-${++seq}`, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const existing = rows.get(id);
      if (!existing) throw new Error("missing sequence");
      const updated = { ...existing, ...data, updatedAt: new Date("2026-04-28T01:00:00Z") };
      rows.set(id, updated);
      return updated;
    },
    delete: async (id) => {
      rows.delete(id);
    },
  };
}

function mockMessageRepo(initial: StepMessage[] = []): StepMessageRepository & {
  rows: StepMessage[];
} {
  const rows = [...initial];
  let seq = rows.length;
  return {
    rows,
    findBySequence: async (sequenceId) =>
      rows.filter((row) => row.sequenceId === sequenceId).sort((a, b) => a.stepIndex - b.stepIndex),
    replaceForSequence: async (sequenceId, inputs: StepMessageCreateInput[]) => {
      for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
        if (rows[idx].sequenceId === sequenceId) rows.splice(idx, 1);
      }
      const now = new Date("2026-04-28T00:00:00Z");
      const created = inputs.map((input) => ({
        ...input,
        id: `msg-${++seq}`,
        createdAt: now,
        updatedAt: now,
      }));
      rows.push(...created);
      return created;
    },
  };
}

function mockEnrollmentRepo(initial: StepEnrollment[] = []): StepEnrollmentRepository & {
  rows: Map<string, StepEnrollment>;
} {
  const rows = new Map(initial.map((row) => [row.id, row]));
  let seq = rows.size;
  return {
    rows,
    findById: async (id) => rows.get(id) ?? null,
    findBySequence: async (sequenceId) =>
      [...rows.values()].filter((row) => row.sequenceId === sequenceId),
    findActiveDue: async ({ now, limit }) =>
      [...rows.values()]
        .filter(
          (row) => row.status === "active" && row.nextStepAt !== null && row.nextStepAt <= now,
        )
        .slice(0, limit),
    countDeliveredBySequenceSince: async (sequenceId, since) =>
      [...rows.values()].filter(
        (row) =>
          row.sequenceId === sequenceId &&
          row.lastDeliveredAt !== null &&
          row.lastDeliveredAt >= since,
      ).length,
    countDeliveredByAccountSince: async (socialAccountId, since) =>
      [...rows.values()].filter(
        (row) =>
          row.socialAccountId === socialAccountId &&
          row.lastDeliveredAt !== null &&
          row.lastDeliveredAt >= since,
      ).length,
    create: async (input: StepEnrollmentCreateInput) => {
      const now = new Date("2026-04-28T00:00:00Z");
      const row = { ...input, id: `enr-${++seq}`, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const existing = rows.get(id);
      if (!existing) throw new Error("missing enrollment");
      const updated = { ...existing, ...data, updatedAt: new Date("2026-04-28T01:00:00Z") };
      rows.set(id, updated);
      return updated;
    },
  };
}

function buildEnrollment(input: Partial<StepEnrollment> = {}): StepEnrollment {
  const now = new Date("2026-04-28T00:00:00Z");
  return {
    id: "enr-1",
    workspaceId: "ws-1",
    sequenceId: "seq-1",
    socialAccountId: "acc-1",
    externalUserId: "user-1",
    username: "alice",
    externalThreadId: "dm:user-1",
    replyToMessageId: null,
    status: "active",
    currentStepIndex: 0,
    nextStepAt: new Date("2026-04-28T00:01:00Z"),
    lastDeliveredAt: null,
    completedAt: null,
    cancelledAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function mockProvider(
  sendReply: (
    input: Parameters<NonNullable<SocialProvider["sendReply"]>>[0],
  ) => Promise<SendReplyResult> = async () => ({
    success: true,
    externalMessageId: "reply-step-1",
  }),
): SocialProvider {
  return {
    platform: "x",
    getCapabilities: () => ({
      textPost: true,
      imagePost: true,
      videoPost: false,
      threadPost: true,
      directMessage: true,
      commentReply: true,
      broadcast: false,
      nativeSchedule: false,
      usageApi: false,
    }),
    connectAccount: async () => ({}),
    validatePost: async () => ({ valid: true, errors: [], warnings: [] }),
    publishPost: async () => ({ success: true, platformPostId: "post-1", publishedAt: null }),
    deletePost: async () => ({ success: true }),
    sendReply: vi.fn(sendReply),
  };
}

function buildDeps(
  options: {
    sequence?: StepSequence;
    messages?: StepMessage[];
    enrollments?: StepEnrollment[];
    provider?: SocialProvider;
  } = {},
): StepSequenceUsecaseDeps & {
  sequenceRepo: ReturnType<typeof mockSequenceRepo>;
  messageRepo: ReturnType<typeof mockMessageRepo>;
  enrollmentRepo: ReturnType<typeof mockEnrollmentRepo>;
  provider: SocialProvider;
} {
  const sequenceRepo = mockSequenceRepo(options.sequence ? [options.sequence] : []);
  const messageRepo = mockMessageRepo(options.messages ?? []);
  const enrollmentRepo = mockEnrollmentRepo(options.enrollments ?? []);
  const provider = options.provider ?? mockProvider();
  return {
    accountRepo: mockAccountRepo(),
    sequenceRepo,
    messageRepo,
    enrollmentRepo,
    providers: new Map([["x", provider]]),
    encryptionKey: TEST_ENCRYPTION_KEY,
    provider,
  };
}

describe("step sequence usecases", () => {
  it("creates an active X sequence with ordered messages", async () => {
    const deps = buildDeps();

    const sequence = await createStepSequence(deps, {
      workspaceId: "ws-1",
      socialAccountId: "acc-1",
      name: " Launch ",
      messages: [
        { delaySeconds: 60, actionType: "dm", contentText: "First" },
        { delaySeconds: 3600, actionType: "mention_post", contentText: "Second" },
      ],
      createdBy: "user-1",
    });

    expect(sequence).toMatchObject({
      name: "Launch",
      platform: "x",
      status: "active",
    });
    expect(deps.messageRepo.rows).toMatchObject([
      { sequenceId: sequence.id, stepIndex: 0, delaySeconds: 60, actionType: "dm" },
      { sequenceId: sequence.id, stepIndex: 1, delaySeconds: 3600, actionType: "mention_post" },
    ]);
  });

  it("enrolls users at the first delayed step", async () => {
    const deps = buildDeps({
      sequence: buildSequence(),
      messages: [buildMessage({ delaySeconds: 300 })],
    });

    const enrollment = await enrollStepSequenceUser(deps, {
      workspaceId: "ws-1",
      sequenceId: "seq-1",
      externalUserId: "user-1",
      username: "alice",
      externalThreadId: "dm:user-1",
      now: new Date("2026-04-28T00:00:00Z"),
    });

    expect(enrollment).toMatchObject({
      status: "active",
      currentStepIndex: 0,
      nextStepAt: new Date("2026-04-28T00:05:00Z"),
    });
  });

  it("delivers due steps and advances the enrollment", async () => {
    const deps = buildDeps({
      sequence: buildSequence(),
      messages: [
        buildMessage({
          id: "msg-1",
          stepIndex: 0,
          delaySeconds: 60,
          actionType: "dm",
          contentText: "First",
        }),
        buildMessage({
          id: "msg-2",
          stepIndex: 1,
          delaySeconds: 120,
          actionType: "mention_post",
          contentText: "Second",
        }),
      ],
      enrollments: [buildEnrollment()],
    });

    const result = await processDueStepSequenceEnrollments(deps, {
      now: new Date("2026-04-28T00:02:00Z"),
      limit: 10,
    });

    expect(result).toMatchObject({
      enrollmentsScanned: 1,
      stepsDelivered: 1,
      enrollmentsCompleted: 0,
    });
    expect(deps.provider.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: "dm:user-1",
        replyToMessageId: null,
        contentText: "First",
      }),
    );
    expect(deps.enrollmentRepo.rows.get("enr-1")).toMatchObject({
      status: "active",
      currentStepIndex: 1,
      nextStepAt: new Date("2026-04-28T00:04:00Z"),
      lastDeliveredAt: new Date("2026-04-28T00:02:00Z"),
    });
  });

  it("does not send cancelled or completed enrollments", async () => {
    const deps = buildDeps({
      sequence: buildSequence(),
      messages: [buildMessage()],
      enrollments: [
        buildEnrollment({ id: "cancelled", status: "cancelled" }),
        buildEnrollment({ id: "completed", status: "completed" }),
      ],
    });

    const result = await processDueStepSequenceEnrollments(deps, {
      now: new Date("2026-04-28T00:02:00Z"),
      limit: 10,
    });

    expect(result.enrollmentsScanned).toBe(0);
    expect(deps.provider.sendReply).not.toHaveBeenCalled();
  });

  it("uses stealth controls for template variation and rate limiting", async () => {
    const provider = mockProvider();
    const deps = buildDeps({
      sequence: buildSequence({
        stealthConfig: {
          accountHourlyLimit: 1,
          templateVariants: ["variant A", "variant B", "variant C"],
        },
      }),
      messages: [buildMessage({ contentText: "fallback" })],
      enrollments: [
        buildEnrollment({ id: "first", externalUserId: "user-1", externalThreadId: "dm:user-1" }),
        buildEnrollment({ id: "second", externalUserId: "user-2", externalThreadId: "dm:user-2" }),
      ],
      provider,
    });

    const result = await processDueStepSequenceEnrollments(deps, {
      now: new Date("2026-04-28T00:02:00Z"),
      limit: 10,
      templateSeed: "seed-1",
    });

    expect(result).toMatchObject({
      stepsDelivered: 1,
      skippedRateLimited: 1,
    });
    expect(provider.sendReply).toHaveBeenCalledTimes(1);
    expect(provider.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        contentText: "variant C",
      }),
    );
  });
});
