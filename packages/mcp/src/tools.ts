import { SnsAgentClient, type SnsAgentHttpMethod } from "@sns-agent/sdk";

type JsonSchemaProperty = {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  additionalProperties?: boolean | JsonSchemaProperty;
};

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

export interface XHarnessMcpTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

interface ToolRoute extends XHarnessMcpTool {
  method: SnsAgentHttpMethod;
  path: string;
  pathParams?: readonly string[];
  queryParams?: readonly string[];
  defaults?: Record<string, string | number | boolean>;
  bodyMode?: "none" | "remaining";
}

export interface McpApiClient {
  request<T>(
    method: SnsAgentHttpMethod,
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    },
  ): Promise<T>;
}

const stringProp = (description: string): JsonSchemaProperty => ({ type: "string", description });
const numberProp = (description: string): JsonSchemaProperty => ({ type: "number", description });
const booleanProp = (description: string): JsonSchemaProperty => ({
  type: "boolean",
  description,
});
const objectProp = (description: string): JsonSchemaProperty => ({
  type: "object",
  description,
  additionalProperties: true,
});
const arrayProp = (description: string): JsonSchemaProperty => ({
  type: "array",
  description,
  items: { type: "object", additionalProperties: true },
});

function schema(
  properties: Record<string, JsonSchemaProperty>,
  required: readonly string[] = [],
): ToolInputSchema {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

const id = stringProp("sns-agent resource id");
const socialAccountId = stringProp("Connected X social account id");
const limit = numberProp("Maximum number of records to return");
const offset = numberProp("Pagination offset");
const cursor = stringProp("Provider pagination cursor");

const TOOL_ROUTES: ToolRoute[] = [
  {
    name: "posts_list",
    description: "List posts, optionally filtered to X.",
    method: "GET",
    path: "/api/posts",
    queryParams: ["platform", "status", "page", "limit", "search", "orderBy"],
    inputSchema: schema({
      platform: stringProp("Platform filter, usually x"),
      status: stringProp("Post status filter"),
      page: numberProp("Page number"),
      limit,
      search: stringProp("Text search"),
      orderBy: stringProp("createdAt, publishedAt, or scheduledAt"),
    }),
  },
  {
    name: "posts_get",
    description: "Get one post.",
    method: "GET",
    path: "/api/posts/{postId}",
    pathParams: ["postId"],
    inputSchema: schema({ postId: id }, ["postId"]),
  },
  {
    name: "posts_create",
    description: "Create an X draft, published post, thread, or quote post.",
    method: "POST",
    path: "/api/posts",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        platform: stringProp("Target platform, usually x"),
        contentText: stringProp("Post text"),
        contentMedia: arrayProp("Media attachments"),
        providerMetadata: objectProp("X provider metadata such as thread or quote settings"),
        publishNow: booleanProp("Publish immediately"),
      },
      ["socialAccountId", "platform"],
    ),
  },
  {
    name: "posts_update",
    description: "Update a draft post.",
    method: "PATCH",
    path: "/api/posts/{postId}",
    pathParams: ["postId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        postId: id,
        contentText: stringProp("Updated text"),
        contentMedia: arrayProp("Updated media attachments"),
        providerMetadata: objectProp("Updated X provider metadata"),
      },
      ["postId"],
    ),
  },
  {
    name: "posts_publish",
    description: "Publish a draft post.",
    method: "POST",
    path: "/api/posts/{postId}/publish",
    pathParams: ["postId"],
    bodyMode: "none",
    inputSchema: schema({ postId: id }, ["postId"]),
  },
  {
    name: "posts_delete",
    description: "Delete a post.",
    method: "DELETE",
    path: "/api/posts/{postId}",
    pathParams: ["postId"],
    bodyMode: "none",
    inputSchema: schema({ postId: id }, ["postId"]),
  },
  {
    name: "dm_threads_list",
    description: "List X inbox and DM threads.",
    method: "GET",
    path: "/api/inbox",
    queryParams: ["platform", "status", "limit", "offset"],
    defaults: { platform: "x" },
    inputSchema: schema({
      platform: stringProp("Platform filter; defaults to x"),
      status: stringProp("open, closed, or archived"),
      limit,
      offset,
    }),
  },
  {
    name: "dm_thread_get",
    description: "Get one inbox or DM thread with messages.",
    method: "GET",
    path: "/api/inbox/{threadId}",
    pathParams: ["threadId"],
    queryParams: ["limit", "offset"],
    inputSchema: schema({ threadId: id, limit, offset }, ["threadId"]),
  },
  {
    name: "dm_sync",
    description: "Sync X inbox and DM threads from the provider.",
    method: "POST",
    path: "/api/inbox/sync",
    bodyMode: "remaining",
    inputSchema: schema({ socialAccountId, limit, cursor }, ["socialAccountId"]),
  },
  {
    name: "dm_reply",
    description: "Reply to an X inbox or DM thread.",
    method: "POST",
    path: "/api/inbox/{threadId}/reply",
    pathParams: ["threadId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        threadId: id,
        contentText: stringProp("Reply text"),
        contentMedia: arrayProp("Reply media attachments"),
      },
      ["threadId"],
    ),
  },
  {
    name: "dm_action",
    description: "Like or repost an inbox thread target.",
    method: "POST",
    path: "/api/inbox/{threadId}/actions",
    pathParams: ["threadId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        threadId: id,
        actionType: { type: "string", enum: ["like", "repost"] },
        targetMessageId: stringProp("Target message id"),
        targetPostId: stringProp("Target X post id"),
      },
      ["threadId", "actionType"],
    ),
  },
  {
    name: "users_accounts_list",
    description: "List connected social accounts used as X user identities.",
    method: "GET",
    path: "/api/accounts",
    inputSchema: schema({}),
  },
  {
    name: "users_account_get",
    description: "Get one connected X account.",
    method: "GET",
    path: "/api/accounts/{accountId}",
    pathParams: ["accountId"],
    inputSchema: schema({ accountId: id }, ["accountId"]),
  },
  {
    name: "users_account_refresh",
    description: "Refresh one connected X account token.",
    method: "POST",
    path: "/api/accounts/{accountId}/refresh",
    pathParams: ["accountId"],
    bodyMode: "none",
    inputSchema: schema({ accountId: id }, ["accountId"]),
  },
  {
    name: "followers_list",
    description: "List X followers with relationship and tag filters.",
    method: "GET",
    path: "/api/followers",
    queryParams: ["socialAccountId", "tagId", "isFollowed", "isFollowing", "limit", "offset"],
    inputSchema: schema({
      socialAccountId,
      tagId: stringProp("Tag id filter"),
      isFollowed: booleanProp("Filter by users that follow the account"),
      isFollowing: booleanProp("Filter by users the account follows"),
      limit,
      offset,
    }),
  },
  {
    name: "followers_sync",
    description: "Sync X followers and following from the provider.",
    method: "POST",
    path: "/api/followers/sync",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        limit,
        followersCursor: cursor,
        followingCursor: cursor,
      },
      ["socialAccountId"],
    ),
  },
  {
    name: "followers_attach_tag",
    description: "Attach a segment tag to a follower.",
    method: "POST",
    path: "/api/followers/{followerId}/tags/{tagId}",
    pathParams: ["followerId", "tagId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        followerId: id,
        tagId: id,
        socialAccountId,
      },
      ["followerId", "tagId", "socialAccountId"],
    ),
  },
  {
    name: "followers_detach_tag",
    description: "Detach a segment tag from a follower.",
    method: "DELETE",
    path: "/api/followers/{followerId}/tags/{tagId}",
    pathParams: ["followerId", "tagId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        followerId: id,
        tagId: id,
        socialAccountId,
      },
      ["followerId", "tagId", "socialAccountId"],
    ),
  },
  {
    name: "follower_analytics_get",
    description: "Read follower snapshot analytics.",
    method: "GET",
    path: "/api/analytics/followers",
    queryParams: ["socialAccountId", "asOfDate"],
    inputSchema: schema(
      {
        socialAccountId,
        asOfDate: stringProp("Optional YYYY-MM-DD analytics date"),
      },
      ["socialAccountId"],
    ),
  },
  {
    name: "follower_snapshot_capture",
    description: "Capture follower snapshots for one account or the workspace.",
    method: "POST",
    path: "/api/analytics/followers/snapshot",
    bodyMode: "remaining",
    inputSchema: schema({
      socialAccountId,
      capturedAt: stringProp("Optional ISO timestamp"),
    }),
  },
  {
    name: "tags_list",
    description: "List X follower segment tags.",
    method: "GET",
    path: "/api/tags",
    queryParams: ["socialAccountId"],
    inputSchema: schema({ socialAccountId }),
  },
  {
    name: "tags_create",
    description: "Create a follower segment tag.",
    method: "POST",
    path: "/api/tags",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        name: stringProp("Tag name"),
        color: stringProp("Optional color value"),
      },
      ["socialAccountId", "name"],
    ),
  },
  {
    name: "tags_update",
    description: "Update a follower segment tag.",
    method: "PATCH",
    path: "/api/tags/{tagId}",
    pathParams: ["tagId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        tagId: id,
        name: stringProp("Tag name"),
        color: stringProp("Optional color value"),
      },
      ["tagId"],
    ),
  },
  {
    name: "tags_delete",
    description: "Delete a follower segment tag.",
    method: "DELETE",
    path: "/api/tags/{tagId}",
    pathParams: ["tagId"],
    bodyMode: "none",
    inputSchema: schema({ tagId: id }, ["tagId"]),
  },
  {
    name: "gates_list",
    description: "List X engagement gates.",
    method: "GET",
    path: "/api/engagement-gates",
    queryParams: ["socialAccountId", "status", "limit"],
    inputSchema: schema({ socialAccountId, status: stringProp("active or paused"), limit }),
  },
  {
    name: "gates_create",
    description: "Create an X engagement gate.",
    method: "POST",
    path: "/api/engagement-gates",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        name: stringProp("Gate name"),
        triggerPostId: stringProp("X trigger post id"),
        conditions: objectProp("Eligibility conditions"),
        actionType: { type: "string", enum: ["mention_post", "dm", "verify_only"] },
        actionText: stringProp("Reward action text"),
        lineHarnessUrl: stringProp("LINE Harness handoff URL"),
        lineHarnessApiKeyRef: stringProp("LINE Harness API key reference"),
        lineHarnessTag: stringProp("LINE tag"),
        lineHarnessScenario: stringProp("LINE scenario"),
        stealthConfig: objectProp("Stealth control configuration"),
      },
      ["socialAccountId", "name", "actionType"],
    ),
  },
  {
    name: "gates_get",
    description: "Get one X engagement gate.",
    method: "GET",
    path: "/api/engagement-gates/{gateId}",
    pathParams: ["gateId"],
    inputSchema: schema({ gateId: id }, ["gateId"]),
  },
  {
    name: "gates_update",
    description: "Update an X engagement gate.",
    method: "PATCH",
    path: "/api/engagement-gates/{gateId}",
    pathParams: ["gateId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        gateId: id,
        name: stringProp("Gate name"),
        status: stringProp("active or paused"),
        conditions: objectProp("Eligibility conditions"),
        actionType: { type: "string", enum: ["mention_post", "dm", "verify_only"] },
        actionText: stringProp("Reward action text"),
        stealthConfig: objectProp("Stealth control configuration"),
      },
      ["gateId"],
    ),
  },
  {
    name: "gates_delete",
    description: "Delete an X engagement gate.",
    method: "DELETE",
    path: "/api/engagement-gates/{gateId}",
    pathParams: ["gateId"],
    bodyMode: "none",
    inputSchema: schema({ gateId: id }, ["gateId"]),
  },
  {
    name: "gates_verify",
    description: "Verify X engagement gate eligibility for a username.",
    method: "GET",
    path: "/api/engagement-gates/{gateId}/verify",
    pathParams: ["gateId"],
    queryParams: ["username"],
    inputSchema: schema(
      {
        gateId: id,
        username: stringProp("X username with or without @"),
      },
      ["gateId", "username"],
    ),
  },
  {
    name: "gates_consume_delivery_token",
    description: "Consume a LINE Harness engagement delivery token.",
    method: "POST",
    path: "/api/engagement-gates/{gateId}/deliveries/consume",
    pathParams: ["gateId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        gateId: id,
        deliveryToken: stringProp("Delivery token to redeem"),
      },
      ["gateId", "deliveryToken"],
    ),
  },
  {
    name: "gates_process",
    description: "Process pending X engagement gate replies.",
    method: "POST",
    path: "/api/engagement-gates/process",
    bodyMode: "remaining",
    inputSchema: schema({ limit }),
  },
  {
    name: "campaigns_list",
    description: "List X campaigns created by the campaign wizard.",
    method: "GET",
    path: "/api/campaigns",
    inputSchema: schema({}),
  },
  {
    name: "campaigns_create",
    description: "Create an X campaign with post, gate, LINE handoff, and optional schedule.",
    method: "POST",
    path: "/api/campaigns",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        name: stringProp("Campaign name"),
        mode: { type: "string", enum: ["draft", "publish", "schedule"] },
        post: objectProp("Campaign post payload"),
        scheduledAt: stringProp("Optional ISO schedule time"),
        conditions: objectProp("Gate eligibility conditions"),
        actionType: { type: "string", enum: ["mention_post", "dm", "verify_only"] },
        actionText: stringProp("Reward action text"),
        lineHarnessUrl: stringProp("LINE Harness handoff URL"),
        lineHarnessApiKeyRef: stringProp("LINE Harness API key reference"),
        lineHarnessTag: stringProp("LINE tag"),
        lineHarnessScenario: stringProp("LINE scenario"),
        stealthConfig: objectProp("Stealth control configuration"),
      },
      ["socialAccountId", "name", "post"],
    ),
  },
  {
    name: "quote_tweets_list",
    description: "List tracked X quote tweets.",
    method: "GET",
    path: "/api/quote-tweets",
    queryParams: ["socialAccountId", "sourceTweetId", "limit", "offset"],
    inputSchema: schema({
      socialAccountId,
      sourceTweetId: stringProp("Source tweet id"),
      limit,
      offset,
    }),
  },
  {
    name: "quote_tweets_sync",
    description: "Discover quote tweets for tracked sources.",
    method: "POST",
    path: "/api/quote-tweets/sync",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        sourceTweetIds: { type: "array", items: { type: "string" } },
        limit,
        cursor,
      },
      ["socialAccountId"],
    ),
  },
  {
    name: "quote_tweet_get",
    description: "Get one tracked quote tweet.",
    method: "GET",
    path: "/api/quote-tweets/{quoteTweetId}",
    pathParams: ["quoteTweetId"],
    inputSchema: schema({ quoteTweetId: id }, ["quoteTweetId"]),
  },
  {
    name: "quote_tweet_action",
    description: "Reply, like, or repost a tracked quote tweet.",
    method: "POST",
    path: "/api/quote-tweets/{quoteTweetId}/actions",
    pathParams: ["quoteTweetId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        quoteTweetId: id,
        actionType: { type: "string", enum: ["reply", "like", "repost"] },
        contentText: stringProp("Reply text when actionType is reply"),
      },
      ["quoteTweetId", "actionType"],
    ),
  },
  {
    name: "staff_audit_list",
    description: "List audit records for staff/API key parity review.",
    method: "GET",
    path: "/api/audit",
    queryParams: ["actorId", "resourceType", "resourceId", "limit"],
    inputSchema: schema({
      actorId: stringProp("User or agent actor id"),
      resourceType: stringProp("Audited resource type"),
      resourceId: stringProp("Audited resource id"),
      limit,
    }),
  },
  {
    name: "staff_approvals_list",
    description: "List approval requests for staff workflows.",
    method: "GET",
    path: "/api/approvals",
    queryParams: ["status", "resourceType", "limit"],
    inputSchema: schema({
      status: stringProp("Approval status"),
      resourceType: stringProp("Resource type"),
      limit,
    }),
  },
  {
    name: "staff_approval_approve",
    description: "Approve a pending staff workflow request.",
    method: "POST",
    path: "/api/approvals/{approvalId}/approve",
    pathParams: ["approvalId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        approvalId: id,
        note: stringProp("Reviewer note"),
      },
      ["approvalId"],
    ),
  },
  {
    name: "staff_approval_reject",
    description: "Reject a pending staff workflow request.",
    method: "POST",
    path: "/api/approvals/{approvalId}/reject",
    pathParams: ["approvalId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        approvalId: id,
        note: stringProp("Reviewer note"),
      },
      ["approvalId"],
    ),
  },
  {
    name: "sequences_list",
    description: "Documented equivalent for X step sequence listing; calls the planned API path.",
    method: "GET",
    path: "/api/step-sequences",
    queryParams: ["socialAccountId", "status", "limit"],
    inputSchema: schema({ socialAccountId, status: stringProp("Sequence status"), limit }),
  },
  {
    name: "sequences_create",
    description: "Documented equivalent for X step sequence creation; calls the planned API path.",
    method: "POST",
    path: "/api/step-sequences",
    bodyMode: "remaining",
    inputSchema: schema(
      {
        socialAccountId,
        name: stringProp("Sequence name"),
        steps: arrayProp("Sequence step definitions"),
      },
      ["socialAccountId", "name", "steps"],
    ),
  },
  {
    name: "sequences_enroll",
    description: "Documented equivalent for enrolling a user into a step sequence.",
    method: "POST",
    path: "/api/step-sequences/{sequenceId}/enrollments",
    pathParams: ["sequenceId"],
    bodyMode: "remaining",
    inputSchema: schema(
      {
        sequenceId: id,
        externalUserId: stringProp("X user id to enroll"),
        username: stringProp("X username to enroll"),
      },
      ["sequenceId"],
    ),
  },
  {
    name: "usage_report",
    description: "Read usage report rows for X parity operations.",
    method: "GET",
    path: "/api/usage",
    queryParams: ["platform", "endpoint", "gateId", "dimension", "period", "from", "to"],
    inputSchema: schema({
      platform: stringProp("Platform filter, usually x"),
      endpoint: stringProp("Endpoint filter"),
      gateId: stringProp("Engagement gate id"),
      dimension: stringProp("platform, endpoint, or gate"),
      period: stringProp("daily, weekly, or monthly"),
      from: stringProp("ISO date"),
      to: stringProp("ISO date"),
    }),
  },
  {
    name: "usage_summary",
    description: "Read usage summary for the current workspace.",
    method: "GET",
    path: "/api/usage/summary",
    inputSchema: schema({}),
  },
];

export const X_HARNESS_MCP_TOOLS: readonly XHarnessMcpTool[] = TOOL_ROUTES.map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
);

const ROUTES_BY_NAME = new Map(TOOL_ROUTES.map((tool) => [tool.name, tool]));

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function definedEntries(
  params: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
  return Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== undefined));
}

export function createToolCaller(client: McpApiClient) {
  return async function callTool(name: string, args: Record<string, unknown> = {}) {
    const tool = ROUTES_BY_NAME.get(name);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }

    const required = tool.inputSchema.required ?? [];
    for (const field of required) {
      if (args[field] === undefined || args[field] === null || args[field] === "") {
        throw new Error(`${field} is required`);
      }
    }

    let path = tool.path;
    const consumed = new Set<string>();
    for (const param of tool.pathParams ?? []) {
      const value = stringValue(args[param], param);
      path = path.replace(`{${param}}`, encodeURIComponent(value));
      consumed.add(param);
    }

    const params: Record<string, string | number | boolean | undefined> = {
      ...(tool.defaults ?? {}),
    };
    for (const param of tool.queryParams ?? []) {
      const value = args[param];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === undefined
      ) {
        params[param] = value;
      }
      consumed.add(param);
    }

    let body: Record<string, unknown> | undefined;
    if (tool.bodyMode === "remaining") {
      body = {};
      for (const [key, value] of Object.entries(args)) {
        if (!consumed.has(key) && value !== undefined) {
          body[key] = value;
        }
      }
    }

    return client.request(tool.method, path, {
      params: definedEntries(params),
      body,
    });
  };
}

export function createClientFromEnv(env: NodeJS.ProcessEnv = process.env): McpApiClient {
  const baseUrl = env.SNS_AGENT_API_URL ?? env.SNS_API_URL;
  const apiKey = env.SNS_AGENT_API_KEY ?? env.SNS_API_KEY;
  if (!baseUrl) {
    throw new Error("SNS_AGENT_API_URL is required");
  }
  if (!apiKey) {
    throw new Error("SNS_AGENT_API_KEY is required");
  }
  return new SnsAgentClient({ baseUrl, apiKey });
}
