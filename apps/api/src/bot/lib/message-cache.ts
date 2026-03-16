import { db } from "../../db";
import { messageAuthors } from "../../db/schema";
import { and, eq, lt } from "drizzle-orm";

const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  fromUserId: number;
  createdAt: number;
}

/** L1 in-memory hot cache */
const cache = new Map<string, CacheEntry>();

function makeKey(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

function evict(): void {
  if (cache.size <= MAX_ENTRIES) return;

  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(key);
    }
  }

  if (cache.size > MAX_ENTRIES) {
    const overflow = cache.size - MAX_ENTRIES;
    const keys = cache.keys();
    for (let i = 0; i < overflow; i++) {
      const { value } = keys.next();
      if (value) cache.delete(value);
    }
  }
}

/**
 * Cache a message author in memory and persist to DB (write-through).
 * DB write is fire-and-forget to avoid blocking the message handler.
 */
export function cacheMessage(
  chatId: string,
  messageId: string,
  fromUserId: number,
): void {
  evict();
  cache.set(makeKey(chatId, messageId), {
    fromUserId,
    createdAt: Date.now(),
  });

  // Write-through to DB (fire-and-forget)
  db.insert(messageAuthors)
    .values({ chatId, messageId, fromUserId })
    .onConflictDoNothing()
    .then(() => {})
    .catch((err) => console.error("Failed to persist message author:", err));
}

/**
 * Look up the author of a message. Checks in-memory cache first,
 * falls back to DB on miss. Returns null only if truly unknown.
 */
export async function getMessageAuthor(
  chatId: string,
  messageId: string,
): Promise<number | null> {
  // L1: in-memory cache
  const key = makeKey(chatId, messageId);
  const entry = cache.get(key);
  if (entry) {
    if (Date.now() - entry.createdAt > TTL_MS) {
      cache.delete(key);
    } else {
      return entry.fromUserId;
    }
  }

  // L2: database fallback
  try {
    const row = await db
      .select({ fromUserId: messageAuthors.fromUserId })
      .from(messageAuthors)
      .where(
        and(
          eq(messageAuthors.chatId, chatId),
          eq(messageAuthors.messageId, messageId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (row) {
      // Backfill L1 cache
      cache.set(key, { fromUserId: row.fromUserId, createdAt: Date.now() });
      return row.fromUserId;
    }
  } catch (err) {
    console.error("Failed to query message author from DB:", err);
  }

  return null;
}

/**
 * Remove message_authors rows older than 24 hours.
 * Call periodically (e.g. every hour) to keep the table small.
 */
export async function cleanupStaleAuthors(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - TTL_MS);
    await db
      .delete(messageAuthors)
      .where(lt(messageAuthors.createdAt, cutoff));
  } catch (err) {
    console.error("Failed to cleanup stale message authors:", err);
  }
}
