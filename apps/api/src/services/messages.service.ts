import { sql, eq, and, inArray, gte, desc } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { generateQueryEmbedding } from "./embeddings.service";
import { truncate } from "../lib/text";

/**
 * Returns true if the given Telegram user has sent at least one message in the given chat.
 */
export async function hasUserMessages(
  chatId: string,
  telegramUserId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramMessages.messageId })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        eq(telegramMessages.fromUserId, telegramUserId),
      ),
    )
    .limit(1);

  return !!row;
}

/**
 * Has this member posted in the given chat since `since`?
 *
 * Used as a proxy for "active community member" when gating expensive tools.
 * Backed by the from_user_id index, so it is a cheap existence check.
 */
export async function hasRecentMessages(
  telegramUserId: number,
  since: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramMessages.messageId })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.fromUserId, telegramUserId),
        gte(telegramMessages.date, since),
      ),
    )
    .limit(1);

  return !!row;
}

export type MessageByIdResult = {
  messageId: number;
  from: string;
  text: string | null;
  date: Date;
  replyToMessageId: number | null;
};

/** Upper bound on ids per lookup, so a confused agent can't fan out. */
export const MAX_MESSAGES_BY_ID = 10;

/**
 * Fetches specific messages by id — a primary-key lookup on (chatId, messageId).
 *
 * History headers quote a replied-to message in truncated form; this is how the
 * agent reads the full text when the snippet isn't enough.
 */
export async function getMessagesByIds(
  chatId: string,
  messageIds: number[],
): Promise<MessageByIdResult[]> {
  const ids = [...new Set(messageIds)].slice(0, MAX_MESSAGES_BY_ID);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      messageId: telegramMessages.messageId,
      text: telegramMessages.text,
      caption: telegramMessages.caption,
      mediaType: telegramMessages.mediaType,
      fromFirstName: telegramMessages.fromFirstName,
      fromUsername: telegramMessages.fromUsername,
      date: telegramMessages.date,
      replyToMessageId: telegramMessages.replyToMessageId,
    })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        inArray(telegramMessages.messageId, ids),
      ),
    )
    .orderBy(telegramMessages.date);

  return rows.map((row) => ({
    messageId: row.messageId,
    from: row.fromUsername
      ? `@${row.fromUsername}`
      : (row.fromFirstName ?? "unknown"),
    text:
      row.text ?? row.caption ?? (row.mediaType ? `[${row.mediaType}]` : null),
    date: row.date,
    replyToMessageId: row.replyToMessageId,
  }));
}

export type MessageSearchResult = {
  chatId: string;
  messageId: number;
  text: string | null;
  caption: string | null;
  fromFirstName: string | null;
  fromUsername: string | null;
  date: Date;
  score: number;
};

/**
 * Full-text search over message text/caption using PostgreSQL tsvector.
 */
export async function searchMessagesFTS(
  chatId: string,
  query: string,
  limit: number,
): Promise<MessageSearchResult[]> {
  const rows = await db
    .select({
      chatId: telegramMessages.chatId,
      messageId: telegramMessages.messageId,
      text: telegramMessages.text,
      caption: telegramMessages.caption,
      fromFirstName: telegramMessages.fromFirstName,
      fromUsername: telegramMessages.fromUsername,
      date: telegramMessages.date,
      score: sql<number>`ts_rank(
        to_tsvector('simple', coalesce(${telegramMessages.text}, '') || ' ' || coalesce(${telegramMessages.caption}, '')),
        plainto_tsquery('simple', ${query})
      )`.as("score"),
    })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        sql`to_tsvector('simple', coalesce(${telegramMessages.text}, '') || ' ' || coalesce(${telegramMessages.caption}, '')) @@ plainto_tsquery('simple', ${query})`,
      ),
    )
    .orderBy(sql`score DESC`)
    .limit(limit);

  return rows;
}

/**
 * Semantic search over messages using pgvector cosine similarity.
 * Returns messages ordered by closest embedding distance.
 */
export async function searchMessagesSemantic(
  chatId: string,
  query: string,
  limit: number,
): Promise<MessageSearchResult[]> {
  const embedding = await generateQueryEmbedding(query);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const rows = await db
    .select({
      chatId: telegramMessages.chatId,
      messageId: telegramMessages.messageId,
      text: telegramMessages.text,
      caption: telegramMessages.caption,
      fromFirstName: telegramMessages.fromFirstName,
      fromUsername: telegramMessages.fromUsername,
      date: telegramMessages.date,
      score:
        sql<number>`1 - (${telegramMessages.embedding} <=> ${vectorLiteral}::vector)`.as(
          "score",
        ),
    })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        sql`${telegramMessages.embedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${telegramMessages.embedding} <=> ${vectorLiteral}::vector`)
    .limit(limit);

  return rows;
}

/**
 * Hybrid search: merges FTS + semantic results using Reciprocal Rank Fusion (RRF).
 * RRF formula: score = sum(1 / (k + rank)) across result lists, k=60 is standard.
 */
export async function searchMessagesHybrid(
  chatId: string,
  query: string,
  limit: number,
): Promise<MessageSearchResult[]> {
  const [ftsResults, semanticResults] = await Promise.all([
    searchMessagesFTS(chatId, query, limit * 2),
    searchMessagesSemantic(chatId, query, limit * 2),
  ]);

  const RRF_K = 60;
  const scores = new Map<number, number>(); // messageId → RRF score
  const byId = new Map<number, MessageSearchResult>();

  for (const [rank, row] of ftsResults.entries()) {
    const id = row.messageId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    byId.set(id, row);
  }

  for (const [rank, row] of semanticResults.entries()) {
    const id = row.messageId;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    byId.set(id, { ...(byId.get(id) ?? row), score: scores.get(id)! });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...byId.get(id)!, score }));
}

/**
 * Updates the embedding for a single message row.
 * Called after insert so new messages are immediately searchable.
 */
export async function setMessageEmbedding(
  chatId: string,
  messageId: number,
  embedding: number[],
): Promise<void> {
  await db
    .update(telegramMessages)
    .set({ embedding })
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        eq(telegramMessages.messageId, messageId),
      ),
    );
}

/**
 * Record that memory extraction has considered these messages.
 *
 * Stamped even when nothing was extracted — the backfill selects on
 * `memory_extracted_at IS NULL`, so a message the live extractor has already
 * read must be stamped or the backfill will pay a second model call to reach
 * the same conclusion, and write a second, differently-worded copy of every
 * fact it finds.
 */
export async function markMemoryExtracted(
  chatId: string,
  messageIds: number[],
): Promise<void> {
  if (!messageIds.length) return;

  await db
    .update(telegramMessages)
    .set({ memoryExtractedAt: new Date() })
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        inArray(telegramMessages.messageId, messageIds),
      ),
    );
}

/** A member's most recent messages, newest first. Feeds profile generation. */
export async function getRecentMessagesByUser(
  telegramUserId: number,
  limit = 100,
): Promise<{ text: string; date: Date }[]> {
  return db
    .select({
      text: sql<string>`coalesce(${telegramMessages.text}, ${telegramMessages.caption})`,
      date: telegramMessages.date,
    })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.fromUserId, telegramUserId),
        sql`coalesce(${telegramMessages.text}, ${telegramMessages.caption}) IS NOT NULL`,
      ),
    )
    .orderBy(desc(telegramMessages.date))
    .limit(limit);
}

/** The messages immediately preceding one, oldest first. Context for extraction. */
export async function getMessageContext(
  chatId: string,
  messageId: number,
  limit: number,
): Promise<{ sender: string; text: string }[]> {
  const rows = await db
    .select({
      sender: sql<string>`coalesce(${telegramMessages.fromFirstName}, 'Unknown')`,
      text: sql<string>`coalesce(${telegramMessages.text}, ${telegramMessages.caption})`,
      messageId: telegramMessages.messageId,
    })
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, chatId),
        sql`${telegramMessages.messageId} < ${messageId}`,
        sql`coalesce(${telegramMessages.text}, ${telegramMessages.caption}) IS NOT NULL`,
      ),
    )
    .orderBy(desc(telegramMessages.messageId))
    .limit(limit);

  // Fetched newest-first for the limit; presented oldest-first for reading.
  return rows
    .reverse()
    .map((r) => ({ sender: r.sender, text: truncate(r.text, 300) }));
}
