import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { telegramTopics } from "../db/schema/bot";

/** The subject a forum topic was created or last renamed to, if known. */
export async function getTopicName(
  chatId: string,
  threadId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ name: telegramTopics.name })
    .from(telegramTopics)
    .where(
      and(
        eq(telegramTopics.chatId, chatId),
        eq(telegramTopics.threadId, threadId),
      ),
    )
    .limit(1);

  return row?.name ?? null;
}

/**
 * Records a forum topic's name from a `forum_topic_created` or
 * `forum_topic_edited` service message.
 */
export async function upsertTopicName(
  chatId: string,
  threadId: number,
  name: string,
): Promise<void> {
  await db
    .insert(telegramTopics)
    .values({ chatId, threadId, name, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [telegramTopics.chatId, telegramTopics.threadId],
      set: { name, updatedAt: new Date() },
    });
}
