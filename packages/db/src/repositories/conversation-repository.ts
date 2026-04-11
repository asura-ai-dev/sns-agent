/**
 * ConversationRepository / MessageRepository の Drizzle 実装
 *
 * Task 6003: 受信・会話管理。
 * core/interfaces/repositories.ts の ConversationRepository / MessageRepository に準拠。
 * design.md セクション 3.1 (conversation_threads, messages) に対応。
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  ConversationFilterOptions,
  ConversationRepository,
  ConversationThread,
  Message,
  MessageFilterOptions,
  MessageRepository,
} from "@sns-agent/core";
import { conversationThreads } from "../schema/conversation-threads.js";
import { messages as messagesTable } from "../schema/messages.js";
import type { DbClient } from "../client.js";

// ───────────────────────────────────────────
// Row -> Entity マッパー
// ───────────────────────────────────────────

function threadRowToEntity(row: typeof conversationThreads.$inferSelect): ConversationThread {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    socialAccountId: row.socialAccountId,
    platform: row.platform as ConversationThread["platform"],
    externalThreadId: row.externalThreadId,
    participantName: row.participantName,
    lastMessageAt: row.lastMessageAt,
    status: row.status as ConversationThread["status"],
    createdAt: row.createdAt,
  };
}

function messageRowToEntity(row: typeof messagesTable.$inferSelect): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    direction: row.direction as Message["direction"],
    contentText: row.contentText,
    contentMedia: row.contentMedia as Message["contentMedia"],
    externalMessageId: row.externalMessageId,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

// ───────────────────────────────────────────
// DrizzleConversationRepository
// ───────────────────────────────────────────

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<ConversationThread | null> {
    const rows = await this.db
      .select()
      .from(conversationThreads)
      .where(eq(conversationThreads.id, id))
      .limit(1);
    return rows.length > 0 ? threadRowToEntity(rows[0]) : null;
  }

  async findByWorkspace(
    workspaceId: string,
    options?: ConversationFilterOptions,
  ): Promise<ConversationThread[]> {
    const conditions = [eq(conversationThreads.workspaceId, workspaceId)];
    if (options?.platform) {
      conditions.push(
        eq(conversationThreads.platform, options.platform as ConversationThread["platform"]),
      );
    }
    if (options?.status) {
      conditions.push(
        eq(conversationThreads.status, options.status as ConversationThread["status"]),
      );
    }

    // 最新メッセージ日時降順。NULL は末尾に来るよう createdAt で補助。
    let query = this.db
      .select()
      .from(conversationThreads)
      .where(and(...conditions))
      .orderBy(desc(conversationThreads.lastMessageAt), desc(conversationThreads.createdAt));

    if (options?.limit !== undefined) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(threadRowToEntity);
  }

  async countByWorkspace(
    workspaceId: string,
    options?: Omit<ConversationFilterOptions, "limit" | "offset">,
  ): Promise<number> {
    const conditions = [eq(conversationThreads.workspaceId, workspaceId)];
    if (options?.platform) {
      conditions.push(
        eq(conversationThreads.platform, options.platform as ConversationThread["platform"]),
      );
    }
    if (options?.status) {
      conditions.push(
        eq(conversationThreads.status, options.status as ConversationThread["status"]),
      );
    }

    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(conversationThreads)
      .where(and(...conditions));

    const raw = rows[0]?.count ?? 0;
    // SQLite drizzle は count(*) を string で返すことがあるため Number 化
    return typeof raw === "number" ? raw : Number(raw);
  }

  async findByExternalThread(
    workspaceId: string,
    socialAccountId: string,
    externalThreadId: string,
  ): Promise<ConversationThread | null> {
    const rows = await this.db
      .select()
      .from(conversationThreads)
      .where(
        and(
          eq(conversationThreads.workspaceId, workspaceId),
          eq(conversationThreads.socialAccountId, socialAccountId),
          eq(conversationThreads.externalThreadId, externalThreadId),
        ),
      )
      .limit(1);
    return rows.length > 0 ? threadRowToEntity(rows[0]) : null;
  }

  async create(thread: Omit<ConversationThread, "id" | "createdAt">): Promise<ConversationThread> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(conversationThreads).values({
      id,
      workspaceId: thread.workspaceId,
      socialAccountId: thread.socialAccountId,
      platform: thread.platform,
      externalThreadId: thread.externalThreadId,
      participantName: thread.participantName,
      lastMessageAt: thread.lastMessageAt,
      status: thread.status,
      createdAt: now,
    });
    return { ...thread, id, createdAt: now };
  }

  async update(id: string, data: Partial<ConversationThread>): Promise<ConversationThread> {
    const updateData: Record<string, unknown> = { ...data };
    delete updateData.id;
    delete updateData.createdAt;

    if (Object.keys(updateData).length > 0) {
      await this.db
        .update(conversationThreads)
        .set(updateData)
        .where(eq(conversationThreads.id, id));
    }

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`ConversationThread not found: ${id}`);
    }
    return updated;
  }
}

// ───────────────────────────────────────────
// DrizzleMessageRepository
// ───────────────────────────────────────────

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly db: DbClient) {}

  async findByThread(threadId: string, options?: MessageFilterOptions): Promise<Message[]> {
    // 古い順 (会話表示用)
    let query = this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, threadId))
      .orderBy(asc(messagesTable.sentAt), asc(messagesTable.createdAt));

    if (options?.limit !== undefined) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;
    return rows.map(messageRowToEntity);
  }

  async countByThread(threadId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(messagesTable)
      .where(eq(messagesTable.threadId, threadId));
    const raw = rows[0]?.count ?? 0;
    return typeof raw === "number" ? raw : Number(raw);
  }

  async create(message: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(messagesTable).values({
      id,
      threadId: message.threadId,
      direction: message.direction,
      contentText: message.contentText,
      contentMedia: message.contentMedia as unknown as Record<string, unknown>[] | null,
      externalMessageId: message.externalMessageId,
      sentAt: message.sentAt,
      createdAt: now,
    });
    return { ...message, id, createdAt: now };
  }
}
