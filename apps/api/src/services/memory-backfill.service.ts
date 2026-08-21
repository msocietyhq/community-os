/**
 * Rebuilds the memory corpus from chat history.
 *
 * Idempotent by construction: every message it considers is stamped with
 * `memory_extracted_at`, whether or not a fact came out of it. So the query for
 * remaining work is "unstamped messages", re-running is a no-op once drained,
 * and a run killed mid-way resumes rather than restarting. Mirrors how
 * `backfillMissingEmbeddings` works off `embedding IS NULL`.
 *
 * Messages are processed in consecutive runs rather than one at a time: the run
 * is its own conversational context, so the model sees the exchange instead of
 * an isolated line, and it costs roughly a tenth as many calls.
 */
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { aiService } from "./ai.service";
import {
  saveMemories,
  resolveSubjectTelegramId,
  type MemoryInput,
} from "./memory.service";
import {
  BATCH_EXTRACTION_PROMPT,
  shouldExtractMemory,
} from "../bot/lib/memory-extractor";
import { withRetry } from "../lib/retry";

/** Messages per model call. Also the size of the context window the model sees. */
const BATCH_SIZE = 10;

/** Rows pulled from the database per round trip. */
const CHUNK_SIZE = 500;

/** Gap between model calls, to stay clear of provider request limits. */
const INTER_BATCH_DELAY_MS = 250;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface BatchFact {
  content: string;
  category: string;
  subject: string;
  confidence?: number;
  message_index?: number;
}

interface PendingMessage {
  chatId: string;
  messageId: number;
  sender: string;
  senderTelegramId: number | null;
  text: string;
}

export interface MemoryBackfillResult {
  scanned: number;
  extracted: number;
  batches: number;
  failed: number;
}

/**
 * Extract from one run of consecutive messages.
 *
 * Facts whose `message_index` is out of range are dropped rather than guessed
 * at — attributing a fact to the wrong message would corrupt its provenance,
 * and provenance is the only way back to what was actually said.
 */
async function extractBatch(batch: PendingMessage[]): Promise<MemoryInput[]> {
  const transcript = batch
    .map((m, i) => `[${i}] ${m.sender}: ${m.text}`)
    .join("\n");

  const result = await aiService.generateText(
    {
      model: aiService.models.fast,
      system: BATCH_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: transcript }],
      maxOutputTokens: 512,
    },
    { caller: "memory-backfill" },
  );

  if (!result.text) return [];

  let facts: BatchFact[];
  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    facts = JSON.parse(match ? match[0] : result.text);
  } catch {
    console.error(
      "[memory-backfill] unparseable response:",
      result.text.slice(0, 200),
    );
    return [];
  }

  if (!Array.isArray(facts)) return [];

  const memories: MemoryInput[] = [];
  for (const fact of facts) {
    const source = batch[fact.message_index ?? -1];
    if (!source || !fact.content) continue;

    const subjectLower = (fact.subject ?? "").toLowerCase();
    const isSender = subjectLower === source.sender.toLowerCase();

    // No fallback to the sender when the subject can't be resolved — pinning an
    // unresolvable subject to whoever spoke is what misattributed 86% of the
    // previous corpus. The sender's own id is used only when the fact is
    // explicitly about them.
    const subjectTelegramId = isSender
      ? source.senderTelegramId
      : await resolveSubjectTelegramId(fact.subject);

    memories.push({
      content: fact.content,
      category: fact.category,
      subject: fact.subject,
      subjectTelegramId,
      sourceChatId: source.chatId,
      sourceMessageId: source.messageId,
      confidence: fact.confidence ?? 0.8,
    });
  }

  return memories;
}

/**
 * Work through every message that has never been considered for extraction.
 *
 * Safe to call on every boot: once drained it does nothing but one count query.
 */
export async function backfillMemories(): Promise<MemoryBackfillResult> {
  const [pending] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(isNull(telegramMessages.memoryExtractedAt));

  const total = pending?.total ?? 0;
  if (!total) {
    console.log("[memory-backfill] nothing pending");
    return { scanned: 0, extracted: 0, batches: 0, failed: 0 };
  }

  console.log(`[memory-backfill] ${total} message(s) pending`);

  let scanned = 0;
  let extracted = 0;
  let batches = 0;
  let failed = 0;

  for (;;) {
    const rows = await db
      .select({
        chatId: telegramMessages.chatId,
        messageId: telegramMessages.messageId,
        sender: sql<string>`coalesce(${telegramMessages.fromFirstName}, 'Unknown')`,
        senderTelegramId: telegramMessages.fromUserId,
        text: sql<string>`coalesce(${telegramMessages.text}, ${telegramMessages.caption})`,
        isBot: telegramMessages.fromIsBot,
      })
      .from(telegramMessages)
      .where(isNull(telegramMessages.memoryExtractedAt))
      // Chronological within a chat so a batch reads as one exchange.
      .orderBy(asc(telegramMessages.chatId), asc(telegramMessages.date))
      .limit(CHUNK_SIZE);

    if (rows.length === 0) break;

    // Everything in the chunk gets stamped, including what the pre-LLM filter
    // rejects — otherwise trivial messages are re-scanned on every run forever.
    const stampKeys = rows.map((r) => ({
      chatId: r.chatId,
      messageId: r.messageId,
    }));

    const eligible: PendingMessage[] = rows
      .filter((r) => r.text && shouldExtractMemory(r.text, r.isBot ?? false))
      .map((r) => ({
        chatId: r.chatId,
        messageId: r.messageId,
        sender: r.sender,
        senderTelegramId: r.senderTelegramId,
        text: r.text.slice(0, 600),
      }));

    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      batches++;
      try {
        const memories = await withRetry(() => extractBatch(batch), {
          onRetry: ({ attempt, delayMs }) =>
            console.warn(
              `[memory-backfill] batch attempt ${attempt} failed, retrying in ${Math.round(delayMs / 1000)}s`,
            ),
        });
        if (memories.length) {
          await saveMemories(memories);
          extracted += memories.length;
        }
      } catch (err) {
        // A failed batch still gets stamped. Leaving it pending would make the
        // next boot retry the same poison batch before reaching new work.
        console.error("[memory-backfill] gave up on a batch:", err);
        failed++;
      }
      await sleep(INTER_BATCH_DELAY_MS);
    }

    await stampProcessed(stampKeys);
    scanned += rows.length;
    console.log(
      `[memory-backfill] ${scanned}/${total} scanned, ${extracted} memories, ${failed} failed batches`,
    );
  }

  console.log(
    `[memory-backfill] complete — ${scanned} scanned, ${extracted} memories from ${batches} batches, ${failed} failed`,
  );
  return { scanned, extracted, batches, failed };
}

/** Mark a chunk as considered, in one statement. */
async function stampProcessed(
  keys: { chatId: string; messageId: number }[],
): Promise<void> {
  if (!keys.length) return;

  // Grouped by chat so this stays a handful of statements rather than one per row.
  const byChat = new Map<string, number[]>();
  for (const k of keys) {
    const list = byChat.get(k.chatId) ?? [];
    list.push(k.messageId);
    byChat.set(k.chatId, list);
  }

  for (const [chatId, ids] of byChat) {
    await db
      .update(telegramMessages)
      .set({ memoryExtractedAt: new Date() })
      .where(
        and(
          sql`${telegramMessages.chatId} = ${chatId}`,
          inArray(telegramMessages.messageId, ids),
        ),
      );
  }
}
