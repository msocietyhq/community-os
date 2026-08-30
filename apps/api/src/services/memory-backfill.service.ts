/**
 * Rebuilds the memory corpus from chat history.
 *
 * Idempotent: every message considered is stamped, so remaining work is
 * "unstamped messages" — re-running is a no-op and an interrupted run resumes.
 * Processed in consecutive runs so each batch is its own context, at roughly a
 * tenth the calls of one-at-a-time.
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
  batchExtractionSchema,
  clampConfidence,
  shouldExtractMemory,
} from "../bot/lib/memory-extractor";
import { withRetry } from "../lib/retry";
import { truncate } from "../lib/text";

/** Messages per model call. Also the size of the context window the model sees. */
const BATCH_SIZE = 10;

/** Rows pulled from the database per round trip. */
const CHUNK_SIZE = 500;

/** Gap between model calls, to stay clear of provider request limits. */
const INTER_BATCH_DELAY_MS = 250;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));


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

/** Extract from one run of consecutive messages. */
async function extractBatch(batch: PendingMessage[]): Promise<MemoryInput[]> {
  const transcript = batch
    .map((m, i) => `[${i}] ${m.sender}: ${m.text}`)
    .join("\n");

  const result = await aiService.generateObject(
    {
      schema: batchExtractionSchema,
      system: BATCH_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: transcript }],
      maxOutputTokens: 1024,
    },
    { caller: "memory-backfill", tier: "micro", class: "background" },
  );

  // Widened to `unknown` by the tracking wrapper; re-parse to recover the type.
  const { facts } = batchExtractionSchema.parse(result.object);

  const memories: MemoryInput[] = [];
  for (const fact of facts) {
    // Rounded because the schema can't constrain it. Out-of-range drops the
    // fact — wrong provenance is worse than one lost fact.
    const index = Math.round(fact.message_index);
    const source = batch[index];
    if (!source || !fact.content) continue;

    const subjectLower = (fact.subject ?? "").toLowerCase();
    const isSender = subjectLower === source.sender.toLowerCase();

    // No fallback to the sender — see memory-extractor.ts. The sender's id is
    // used only when the fact is explicitly about them.
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
      confidence: clampConfidence(fact.confidence),
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

    // Stamp everything, including filter rejects, or they're re-scanned forever.
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
        text: truncate(r.text, 600),
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
        // Still stamped: leaving it pending would retry a poison batch forever.
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

  // Grouped by chat: a handful of statements rather than one per row.
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
