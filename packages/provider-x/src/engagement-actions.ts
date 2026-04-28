import type {
  EngagementActionResult,
  PerformEngagementActionInput,
} from "@sns-agent/core";
import { XApiClient } from "./http-client.js";
import { XApi } from "./x-api.js";
import { requireXAccessTokenCredentials } from "./credentials.js";

export async function performEngagementAction(
  input: PerformEngagementActionInput,
  httpClient: XApiClient,
): Promise<EngagementActionResult> {
  const creds = requireXAccessTokenCredentials(
    input.accountCredentials,
    "inbox.performEngagementAction",
  );
  const userId = creds.xUserId ?? input.accountExternalId;
  const api = new XApi(httpClient, creds.accessToken);

  try {
    if (input.actionType === "like") {
      const res = await api.likeTweet(userId, input.targetPostId);
      return {
        success: res.data?.data?.liked !== false,
        externalActionId: `${userId}:like:${input.targetPostId}`,
      };
    }

    const res = await api.repostTweet(userId, input.targetPostId);
    return {
      success: res.data?.data?.retweeted !== false,
      externalActionId: `${userId}:repost:${input.targetPostId}`,
    };
  } catch (err) {
    return {
      success: false,
      externalActionId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
