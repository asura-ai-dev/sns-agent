/**
 * UserRepository の Drizzle 実装
 * Task 2001: 認証ユースケースの依存として User の CRUD を提供
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { User } from "@sns-agent/core";
import { users } from "../schema/users.js";
import type { DbClient } from "../client.js";

/**
 * User Repository インターフェース
 * core/interfaces に追加予定だが、まず db 側で定義して利用する
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByWorkspace(workspaceId: string): Promise<User[]>;
  create(user: Omit<User, "id" | "createdAt">): Promise<User>;
  update(id: string, data: Partial<Pick<User, "name" | "email" | "role">>): Promise<User>;
}

function rowToEntity(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    name: row.name,
    role: row.role as User["role"],
    createdAt: row.createdAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<User[]> {
    const rows = await this.db.select().from(users).where(eq(users.workspaceId, workspaceId));
    return rows.map(rowToEntity);
  }

  async create(user: Omit<User, "id" | "createdAt">): Promise<User> {
    const now = new Date();
    const id = randomUUID();
    await this.db.insert(users).values({
      id,
      workspaceId: user.workspaceId,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: now,
    });
    return { ...user, id, createdAt: now };
  }

  async update(id: string, data: Partial<Pick<User, "name" | "email" | "role">>): Promise<User> {
    await this.db.update(users).set(data).where(eq(users.id, id));
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`User not found: ${id}`);
    }
    return updated;
  }
}
