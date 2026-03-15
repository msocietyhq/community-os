import type { StorageAdapter } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { botSession } from "../db/schema/bot";
import type { SessionData } from "./types";

export class PostgresSessionStorage implements StorageAdapter<SessionData> {
  async read(key: string): Promise<SessionData | undefined> {
    const row = await db
      .select()
      .from(botSession)
      .where(eq(botSession.key, key))
      .limit(1)
      .then((rows) => rows[0]);

    return row ? (row.value as SessionData) : undefined;
  }

  async write(key: string, value: SessionData): Promise<void> {
    await db
      .insert(botSession)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: botSession.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async delete(key: string): Promise<void> {
    await db.delete(botSession).where(eq(botSession.key, key));
  }
}
