import { sql, eq, and, or, isNull, desc } from "drizzle-orm";
import { db } from "../db";
import { botMemories } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import {
  generateEmbedding,
  generateQueryEmbedding,
} from "./embeddings.service";
import {
  applyRelativeCutoff,
  rankByConfidenceAndRecency,
} from "./memory-ranking";
import { getSimilarityFloor } from "./recall-calibration";
import { fuseByRRF } from "./reciprocal-rank-fusion";

export interface MemoryInput {
  content: string;
  category: string;
  subject?: string | null;
  subjectTelegramId?: number | null;
  sourceChatId?: string | null;
  sourceMessageId?: number | null;
  confidence?: number;
}

export interface RecalledMemory {
  id: string;
  content: string;
  category: string;
  subject: string | null;
  confidence: number;
  similarity: number;
  createdAt: Date;
  /**
   * The chat message this fact was learned from, when known.
   *
   * A memory is a one-line assertion stripped of its context. This is the way
   * back to what was actually said — fetchable via chat_history.
   */
  sourceChatId: string | null;
  sourceMessageId: number | null;
}

/**
 * Check for an existing semantically similar memory (cosine > 0.85)
 * with the same subject and category.
 */
async function findDuplicate(
  embedding: number[],
  subject: string | null | undefined,
  category: string,
): Promise<{ id: string; content: string } | null> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  const conditions = [
    isNull(botMemories.supersededBy),
    eq(botMemories.category, category),
    sql`1 - (${botMemories.embedding} <=> ${vectorLiteral}::vector) > 0.85`,
  ];

  if (subject) {
    conditions.push(eq(botMemories.subject, subject));
  }

  const [row] = await db
    .select({
      id: botMemories.id,
      content: botMemories.content,
    })
    .from(botMemories)
    .where(and(...conditions))
    .limit(1);

  return row ?? null;
}

export interface SaveMemoryResult {
  id: string | null;
  status: "inserted" | "superseded" | "skipped_duplicate";
  supersededId?: string;
}

/**
 * Save a single memory with embedding generation and deduplication.
 * If a duplicate exists, supersedes it.
 */
export async function saveMemory(memory: MemoryInput): Promise<SaveMemoryResult> {
  const embedding = await generateEmbedding(memory.content);

  const duplicate = await findDuplicate(
    embedding,
    memory.subject,
    memory.category,
  );

  if (duplicate) {
    // If content is essentially the same, skip
    if (duplicate.content.toLowerCase() === memory.content.toLowerCase()) {
      return { id: null, status: "skipped_duplicate" };
    }

    // Supersede the old memory
    await db
      .update(botMemories)
      .set({
        supersededBy: sql`gen_random_uuid()`, // placeholder, will be replaced
        supersededAt: new Date(),
      })
      .where(eq(botMemories.id, duplicate.id));
  }

  const [inserted] = await db
    .insert(botMemories)
    .values({
      content: memory.content,
      category: memory.category,
      subject: memory.subject ?? null,
      subjectTelegramId: memory.subjectTelegramId ?? null,
      sourceChatId: memory.sourceChatId ?? null,
      sourceMessageId: memory.sourceMessageId ?? null,
      confidence: memory.confidence ?? 0.8,
      embedding,
    })
    .returning({ id: botMemories.id });

  // Update the superseded record to point to the new one
  if (duplicate && inserted) {
    await db
      .update(botMemories)
      .set({ supersededBy: inserted.id })
      .where(eq(botMemories.id, duplicate.id));

    return { id: inserted.id, status: "superseded", supersededId: duplicate.id };
  }

  return { id: inserted?.id ?? null, status: "inserted" };
}

/**
 * Save multiple memories in sequence (each gets dedup check).
 */
export async function saveMemories(
  memories: MemoryInput[],
): Promise<SaveMemoryResult[]> {
  const results: SaveMemoryResult[] = [];
  for (const memory of memories) {
    const result = await saveMemory(memory);
    results.push(result);
  }
  return results;
}

/**
 * Semantic search over active memories.
 *
 * `minSimilarity` is a noise floor only — pass `relativeCutoff` to narrow the
 * result set to the cluster around the best match. See `memory-ranking.ts` for
 * why an absolute threshold alone doesn't work here.
 */
export async function recallMemories(
  query: string,
  opts?: { limit?: number; minSimilarity?: number; relativeCutoff?: number },
): Promise<RecalledMemory[]> {
  const limit = opts?.limit ?? 5;
  const minSimilarity = opts?.minSimilarity ?? getSimilarityFloor();

  const embedding = await generateQueryEmbedding(query);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const rows = await db
    .select({
      id: botMemories.id,
      content: botMemories.content,
      category: botMemories.category,
      subject: botMemories.subject,
      confidence: botMemories.confidence,
      similarity:
        sql<number>`1 - (${botMemories.embedding} <=> ${vectorLiteral}::vector)`.as(
          "similarity",
        ),
      createdAt: botMemories.createdAt,
      sourceChatId: botMemories.sourceChatId,
      sourceMessageId: botMemories.sourceMessageId,
    })
    .from(botMemories)
    .where(
      and(
        isNull(botMemories.supersededBy),
        sql`${botMemories.embedding} IS NOT NULL`,
        sql`1 - (${botMemories.embedding} <=> ${vectorLiteral}::vector) > ${minSimilarity}`,
      ),
    )
    .orderBy(sql`${botMemories.embedding} <=> ${vectorLiteral}::vector`)
    .limit(limit);

  return opts?.relativeCutoff !== undefined
    ? applyRelativeCutoff(rows, opts.relativeCutoff)
    : rows;
}

/**
 * Exact-token search over memory content.
 *
 * Complements the embedding: cosine similarity is strong on meaning and weak
 * on literals — names, domains, acronyms — which roughly a fifth of memories
 * contain.
 */
export async function searchMemoriesFTS(
  query: string,
  limit: number,
): Promise<RecalledMemory[]> {
  return db
    .select({
      id: botMemories.id,
      content: botMemories.content,
      category: botMemories.category,
      subject: botMemories.subject,
      confidence: botMemories.confidence,
      similarity: sql<number>`ts_rank(
        to_tsvector('simple', coalesce(${botMemories.content}, '')),
        plainto_tsquery('simple', ${query})
      )`.as("similarity"),
      createdAt: botMemories.createdAt,
      sourceChatId: botMemories.sourceChatId,
      sourceMessageId: botMemories.sourceMessageId,
    })
    .from(botMemories)
    .where(
      and(
        isNull(botMemories.supersededBy),
        sql`to_tsvector('simple', coalesce(${botMemories.content}, '')) @@ plainto_tsquery('simple', ${query})`,
      ),
    )
    .orderBy(sql`similarity DESC`)
    .limit(limit);
}

/**
 * Merges semantic and exact-token recall with Reciprocal Rank Fusion, the same
 * scheme `searchMessagesHybrid` uses (k=60).
 *
 * Fusing on *rank* rather than score matters here: cosine similarity and
 * ts_rank aren't on comparable scales, so they can't simply be added.
 */
export async function recallMemoriesHybrid(
  query: string,
  opts?: { limit?: number; minSimilarity?: number; relativeCutoff?: number },
): Promise<RecalledMemory[]> {
  const limit = opts?.limit ?? 5;

  const [semantic, lexical] = await Promise.all([
    recallMemories(query, { ...opts, limit: limit * 2 }),
    searchMemoriesFTS(query, limit * 2).catch(() => [] as RecalledMemory[]),
  ]);

  // Semantic first: when a memory appears in both, its similarity is the
  // meaningful one, and fuseByRRF keeps the row from the earliest list.
  return fuseByRRF([semantic, lexical], (m) => m.id, limit);
}

/** How many candidates to weigh before trimming to `limit`. */
const SUBJECT_CANDIDATE_MULTIPLIER = 4;

/**
 * Fetch active memories about a specific telegram user.
 *
 * Pulls a wider candidate set than needed and ranks it by confidence decayed
 * over time, so a durable high-confidence fact isn't pushed out by recent
 * low-confidence trivia (one subject here has 53 memories).
 */
export async function recallMemoriesForSubject(
  telegramId: number,
  limit = 10,
  now: Date = new Date(),
): Promise<RecalledMemory[]> {
  const rows = await db
    .select({
      id: botMemories.id,
      content: botMemories.content,
      category: botMemories.category,
      subject: botMemories.subject,
      confidence: botMemories.confidence,
      similarity: sql<number>`1`.as("similarity"),
      createdAt: botMemories.createdAt,
      sourceChatId: botMemories.sourceChatId,
      sourceMessageId: botMemories.sourceMessageId,
    })
    .from(botMemories)
    .where(
      and(
        isNull(botMemories.supersededBy),
        eq(botMemories.subjectTelegramId, telegramId),
      ),
    )
    .orderBy(desc(botMemories.createdAt))
    .limit(limit * SUBJECT_CANDIDATE_MULTIPLIER);

  return rankByConfidenceAndRecency(rows, now, limit);
}

/**
 * Soft-delete a memory by marking it as superseded with no replacement.
 */
export async function forgetMemory(memoryId: string): Promise<void> {
  await db
    .update(botMemories)
    .set({
      supersededBy: memoryId, // self-reference indicates explicit forget
      supersededAt: new Date(),
    })
    .where(eq(botMemories.id, memoryId));
}

/**
 * Forget all active memories about a subject.
 * Optionally filter by content hint (partial match).
 */
export async function forgetMemoriesBySubject(
  subject: string,
  contentHint?: string,
): Promise<number> {
  const conditions = [
    isNull(botMemories.supersededBy),
    sql`lower(${botMemories.subject}) = lower(${subject})`,
  ];

  if (contentHint) {
    conditions.push(
      sql`lower(${botMemories.content}) LIKE lower(${"%" + contentHint + "%"})`,
    );
  }

  const rows = await db
    .select({ id: botMemories.id })
    .from(botMemories)
    .where(and(...conditions));

  if (rows.length === 0) return 0;

  for (const row of rows) {
    await forgetMemory(row.id);
  }

  return rows.length;
}

/**
 * Fire-and-forget access count increment for recalled memories.
 */
/**
 * Best-effort resolve a subject name to a telegram user ID
 * by matching against the user table's name or telegram_username.
 * Returns null if no match found.
 */
export async function resolveSubjectTelegramId(
  subject: string,
): Promise<number | null> {
  const lower = subject.toLowerCase();

  const [row] = await db
    .select({ telegramId: user.telegramId })
    .from(user)
    .where(
      and(
        or(
          sql`lower(${user.name}) = ${lower}`,
          sql`lower(${user.telegramUsername}) = ${lower}`,
        ),
        sql`${user.telegramId} IS NOT NULL`,
      ),
    )
    .limit(1);

  return row?.telegramId ? Number(row.telegramId) : null;
}

export function incrementAccessCount(memoryIds: string[]): void {
  if (memoryIds.length === 0) return;
  db.update(botMemories)
    .set({
      accessCount: sql`${botMemories.accessCount} + 1`,
      lastAccessedAt: new Date(),
    })
    .where(sql`${botMemories.id} IN ${memoryIds}`)
    .catch((err) => {
      console.error("[memory] failed to increment access count:", err);
    });
}
