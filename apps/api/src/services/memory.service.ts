import { sql, eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db";
import { botMemories } from "../db/schema/bot";
import { user } from "../db/schema/auth";
import {
  generateEmbedding,
  generateQueryEmbedding,
} from "./embeddings.service";

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
 * Semantic search over active memories. Returns top matches above similarity threshold.
 */
export async function recallMemories(
  query: string,
  opts?: { limit?: number; minSimilarity?: number },
): Promise<RecalledMemory[]> {
  const limit = opts?.limit ?? 5;
  const minSimilarity = opts?.minSimilarity ?? 0.6;

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

  return rows;
}

/**
 * Fetch active memories about a specific telegram user.
 */
export async function recallMemoriesForSubject(
  telegramId: number,
  limit = 10,
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
    })
    .from(botMemories)
    .where(
      and(
        isNull(botMemories.supersededBy),
        eq(botMemories.subjectTelegramId, telegramId),
      ),
    )
    .orderBy(botMemories.createdAt)
    .limit(limit);

  return rows;
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
