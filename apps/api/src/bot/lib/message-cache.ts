const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  fromUserId: number;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function makeKey(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

function evict(): void {
  if (cache.size <= MAX_ENTRIES) return;

  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(key);
    }
  }

  // If still over limit, remove oldest entries
  if (cache.size > MAX_ENTRIES) {
    const overflow = cache.size - MAX_ENTRIES;
    const keys = cache.keys();
    for (let i = 0; i < overflow; i++) {
      const { value } = keys.next();
      if (value) cache.delete(value);
    }
  }
}

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
}

export function getMessageAuthor(
  chatId: string,
  messageId: string,
): number | null {
  const entry = cache.get(makeKey(chatId, messageId));
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(makeKey(chatId, messageId));
    return null;
  }
  return entry.fromUserId;
}
