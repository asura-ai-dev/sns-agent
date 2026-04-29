import type {
  EngagementGate,
  EngagementGateActionType,
  EngagementGateConditions,
  EngagementGateStealthConfig,
  Post,
  PostProviderMetadata,
  ScheduledJob,
} from "../domain/entities.js";
import type { EngagementGateUsecaseDeps } from "./engagement-gates.js";
import type { PostUsecaseDeps } from "./post.js";
import type { ScheduleUsecaseDeps } from "./schedule.js";
import { ValidationError } from "../errors/domain-error.js";
import {
  createEngagementGate,
  listEngagementGates,
  updateEngagementGate,
} from "./engagement-gates.js";
import { createPost, publishPostChecked } from "./post.js";
import { schedulePost } from "./schedule.js";

export type CampaignMode = "draft" | "publish" | "schedule";

export interface CampaignUsecaseDeps {
  postDeps: PostUsecaseDeps;
  gateDeps: EngagementGateUsecaseDeps;
  scheduleDeps?: ScheduleUsecaseDeps;
}

export interface CreateCampaignInput {
  workspaceId: string;
  socialAccountId: string;
  name: string;
  mode: CampaignMode;
  post: {
    contentText?: string | null;
    contentMedia?: Post["contentMedia"];
    providerMetadata?: PostProviderMetadata | null;
  };
  scheduledAt?: Date | null;
  conditions?: EngagementGateConditions | null;
  actionType: EngagementGateActionType;
  actionText?: string | null;
  lineHarnessUrl?: string | null;
  lineHarnessApiKeyRef?: string | null;
  lineHarnessTag?: string | null;
  lineHarnessScenario?: string | null;
  stealthConfig?: EngagementGateStealthConfig | null;
  createdBy?: string | null;
}

export interface CampaignRecord {
  id: string;
  mode: CampaignMode;
  post: Post;
  gate: EngagementGate;
  schedule: ScheduledJob | null;
  verifyUrl: string;
}

export interface CampaignListItem {
  id: string;
  name: string;
  mode: CampaignMode;
  postStatus: Post["status"] | "missing";
  gateStatus: EngagementGate["status"];
  postText: string | null;
  conditions: EngagementGateConditions | null;
  lineHarness: {
    url: string | null;
    tag: string | null;
    scenario: string | null;
  };
  verifyUrl: string;
  updatedAt: Date;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("name is required");
  return trimmed;
}

function verifyUrl(gateId: string): string {
  return `/api/engagement-gates/${gateId}/verify`;
}

function modeForPost(post: Post | null, gate: EngagementGate): CampaignMode {
  if (post?.status === "published" || gate.status === "active") return "publish";
  if (post?.status === "scheduled") return "schedule";
  return "draft";
}

export async function createCampaign(
  deps: CampaignUsecaseDeps,
  input: CreateCampaignInput,
): Promise<CampaignRecord> {
  const mode = input.mode;
  if (mode === "schedule" && !deps.scheduleDeps) {
    throw new ValidationError("schedule dependencies are required");
  }
  if (mode === "schedule" && !input.scheduledAt) {
    throw new ValidationError("scheduledAt is required for scheduled campaigns");
  }

  const name = normalizeName(input.name);
  let post = await createPost(deps.postDeps, {
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    contentText: input.post.contentText ?? null,
    contentMedia: input.post.contentMedia ?? null,
    providerMetadata: input.post.providerMetadata ?? null,
    publishNow: false,
    createdBy: input.createdBy ?? null,
  });

  let gate = await createEngagementGate(deps.gateDeps, {
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    name,
    triggerPostId: post.id,
    conditions: input.conditions ?? null,
    actionType: input.actionType,
    actionText: input.actionText ?? null,
    lineHarnessUrl: input.lineHarnessUrl ?? null,
    lineHarnessApiKeyRef: input.lineHarnessApiKeyRef ?? null,
    lineHarnessTag: input.lineHarnessTag ?? null,
    lineHarnessScenario: input.lineHarnessScenario ?? null,
    stealthConfig: input.stealthConfig ?? null,
    createdBy: input.createdBy ?? null,
  });

  let schedule: ScheduledJob | null = null;

  if (mode === "draft") {
    gate = await updateEngagementGate(deps.gateDeps, {
      workspaceId: input.workspaceId,
      id: gate.id,
      status: "paused",
    });
  }

  if (mode === "schedule") {
    gate = await updateEngagementGate(deps.gateDeps, {
      workspaceId: input.workspaceId,
      id: gate.id,
      status: "paused",
    });
    schedule = await schedulePost(deps.scheduleDeps as ScheduleUsecaseDeps, {
      workspaceId: input.workspaceId,
      postId: post.id,
      scheduledAt: input.scheduledAt as Date,
    });
    post = await deps.postDeps.postRepo.findById(post.id).then((found) => found ?? post);
  }

  if (mode === "publish") {
    const published = await publishPostChecked(deps.postDeps, input.workspaceId, post.id, {
      requestedBy: input.createdBy ?? null,
    });
    post = published.post;
    if (post.status === "published" && post.platformPostId) {
      gate = await updateEngagementGate(deps.gateDeps, {
        workspaceId: input.workspaceId,
        id: gate.id,
        status: "active",
        triggerPostId: post.platformPostId,
      });
    } else {
      gate = await updateEngagementGate(deps.gateDeps, {
        workspaceId: input.workspaceId,
        id: gate.id,
        status: "paused",
      });
    }
  }

  return {
    id: gate.id,
    mode,
    post,
    gate,
    schedule,
    verifyUrl: verifyUrl(gate.id),
  };
}

export async function listCampaigns(
  deps: CampaignUsecaseDeps,
  workspaceId: string,
): Promise<CampaignListItem[]> {
  const [posts, gates] = await Promise.all([
    deps.postDeps.postRepo.findByWorkspace(workspaceId, {
      platform: "x",
      limit: 100,
    }),
    listEngagementGates(deps.gateDeps, workspaceId, { limit: 100 }),
  ]);

  const postsById = new Map(posts.map((post) => [post.id, post]));
  const postsByPlatformId = new Map(
    posts
      .filter((post): post is Post & { platformPostId: string } => !!post.platformPostId)
      .map((post) => [post.platformPostId, post]),
  );

  return gates.map((gate) => {
    const post =
      (gate.triggerPostId ? postsById.get(gate.triggerPostId) : undefined) ??
      (gate.triggerPostId ? postsByPlatformId.get(gate.triggerPostId) : undefined) ??
      null;
    return {
      id: gate.id,
      name: gate.name,
      mode: modeForPost(post, gate),
      postStatus: post?.status ?? "missing",
      gateStatus: gate.status,
      postText: post?.contentText ?? null,
      conditions: gate.conditions,
      lineHarness: {
        url: gate.lineHarnessUrl,
        tag: gate.lineHarnessTag,
        scenario: gate.lineHarnessScenario,
      },
      verifyUrl: verifyUrl(gate.id),
      updatedAt: gate.updatedAt,
    };
  });
}
