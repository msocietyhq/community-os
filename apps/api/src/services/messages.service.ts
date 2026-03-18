import { sql, eq, and } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { generateQueryEmbedding } from "./embeddings.service";

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
      score: sql<number>`1 - (${telegramMessages.embedding} <=> ${vectorLiteral}::vector)`.as(
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
