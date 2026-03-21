/**
 * One-time script to extract memories from existing telegram_messages.
 * Processes messages from the past 2 years, batching messages per Haiku call.
 *
 * Usage: bun run --cwd apps/api src/scripts/backfill-memories.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql, and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { telegramMessages } from "../db/schema/bot";
import { saveMemories, resolveSubjectTelegramId, type MemoryInput } from "../services/memory.service";
import { shouldExtractMemory } from "../bot/lib/memory-extractor";
import { env } from "../env";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const BATCH_SIZE = 10;
const CHUNK_SIZE = 100; // DB fetch chunk
const RATE_LIMIT_DELAY_MS = 500;
const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);

const BATCH_EXTRACTION_PROMPT = `You extract noteworthy facts from group chat messages. Each message is labeled with the sender name.

Return a JSON array of facts, or an empty array if none worth remembering.

Each fact should be:
- A standalone statement (e.g. "Ali works at Stripe")
- Categorized as: person_fact | community_preference | decision | technical | event_related | general
- Attributed to a subject (who/what it's about)
- Linked to the message index (0-based) it came from

Rules:
- Only extract facts useful to recall later
- Skip greetings, small talk, jokes, opinions
- Keep facts concise (one sentence)
- Set confidence 0.6-1.0

Respond with ONLY a JSON array:
[{"content": "...", "category": "...", "subject": "...", "confidence": 0.8, "message_index": 0}]
Or [] if nothing worth remembering.`;

interface MessageRow {
  chatId: string;
  messageId: number;
  text: string | null;
  fromFirstName: string | null;
  fromUsername: string | null;
  fromUserId: number | null;
  fromIsBot: boolean | null;
}

async function extractBatch(
  messages: MessageRow[],
  batchIndex: number,
): Promise<MemoryInput[]> {
  const batchStart = performance.now();

  const formatted = messages
    .map((m, i) => {
      const sender = m.fromUsername
        ? `${m.fromFirstName ?? "Unknown"} (@${m.fromUsername})`
        : (m.fromFirstName ?? "Unknown");
      return `[${i}] ${sender}: "${m.text}"`;
    })
    .join("\n");

  console.log(`[backfill:batch-${batchIndex}] sending ${messages.length} messages to Haiku...`);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: formatted }],
    system: BATCH_EXTRACTION_PROMPT,
  });

  const llmMs = Math.round(performance.now() - batchStart);
  console.log(`[backfill:batch-${batchIndex}] Haiku responded in ${llmMs}ms (${response.usage.input_tokens}in/${response.usage.output_tokens}out)`);

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    console.warn(`[backfill:batch-${batchIndex}] empty or non-text response`);
    return [];
  }

  let facts: Array<{
    content: string;
    category: string;
    subject: string;
    confidence?: number;
    message_index: number;
  }>;

  try {
    const jsonMatch = firstBlock.text.match(/\[[\s\S]*\]/);
    facts = JSON.parse(jsonMatch ? jsonMatch[0] : firstBlock.text);
  } catch {
    console.error(`[backfill:batch-${batchIndex}] failed to parse response:`, firstBlock.text.slice(0, 300));
    return [];
  }

  if (!Array.isArray(facts)) {
    console.warn(`[backfill:batch-${batchIndex}] response is not an array`);
    return [];
  }

  if (facts.length === 0) {
    console.log(`[backfill:batch-${batchIndex}] no facts extracted`);
    return [];
  }

  console.log(`[backfill:batch-${batchIndex}] extracted ${facts.length} raw facts`);

  const validFacts = facts.filter(
    (f) => f.message_index >= 0 && f.message_index < messages.length,
  );

  if (validFacts.length < facts.length) {
    console.warn(`[backfill:batch-${batchIndex}] dropped ${facts.length - validFacts.length} facts with invalid message_index`);
  }

  const memories: MemoryInput[] = [];
  for (const f of validFacts) {
    const msg = messages[f.message_index]!;

    // If subject matches the sender, use sender's ID. Otherwise, look it up.
    const senderName = (msg.fromFirstName ?? "").toLowerCase();
    const senderUsername = (msg.fromUsername ?? "").toLowerCase();
    const subjectLower = (f.subject ?? "").toLowerCase();

    const isSender =
      subjectLower === senderName ||
      subjectLower === senderUsername ||
      subjectLower === "i" ||
      subjectLower === "me";

    let subjectTelegramId: number | null;
    if (isSender) {
      subjectTelegramId = msg.fromUserId;
      console.log(`[backfill:batch-${batchIndex}]   "${f.content}" → subject "${f.subject}" = sender (tid:${subjectTelegramId})`);
    } else {
      const resolved = await resolveSubjectTelegramId(f.subject);
      if (resolved) {
        subjectTelegramId = resolved;
        console.log(`[backfill:batch-${batchIndex}]   "${f.content}" → subject "${f.subject}" resolved to tid:${resolved}`);
      } else {
        subjectTelegramId = msg.fromUserId;
        console.log(`[backfill:batch-${batchIndex}]   "${f.content}" → subject "${f.subject}" not found, fallback to sender tid:${msg.fromUserId}`);
      }
    }

    memories.push({
      content: f.content,
      category: f.category,
      subject: f.subject,
      subjectTelegramId,
      sourceChatId: msg.chatId,
      sourceMessageId: msg.messageId,
      confidence: f.confidence ?? 0.8,
    });
  }

  const batchMs = Math.round(performance.now() - batchStart);
  console.log(`[backfill:batch-${batchIndex}] resolved ${memories.length} memories in ${batchMs}ms total`);

  return memories;
}

async function main() {
  const startTime = performance.now();
  console.log("[backfill] Starting memory backfill from past 2 years...");
  console.log(`[backfill] Config: BATCH_SIZE=${BATCH_SIZE}, CHUNK_SIZE=${CHUNK_SIZE}, RATE_LIMIT=${RATE_LIMIT_DELAY_MS}ms`);

  // Count total eligible messages
  const countResult = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(telegramMessages)
    .where(
      and(
        isNotNull(telegramMessages.text),
        eq(telegramMessages.fromIsBot, false),
        gte(telegramMessages.date, TWO_YEARS_AGO),
      ),
    );

  const total = countResult[0]?.total ?? 0;
  console.log(`[backfill] Found ${total} candidate messages`);

  let processed = 0;
  let extracted = 0;
  let skippedFilter = 0;
  let skippedDuplicate = 0;
  let superseded = 0;
  let parseFails = 0;
  let batchErrors = 0;
  let batchIndex = 0;
  let offset = 0;

  while (offset < total) {
    // Fetch a chunk of messages
    const rows = await db
      .select({
        chatId: telegramMessages.chatId,
        messageId: telegramMessages.messageId,
        text: telegramMessages.text,
        fromFirstName: telegramMessages.fromFirstName,
        fromUsername: telegramMessages.fromUsername,
        fromUserId: telegramMessages.fromUserId,
        fromIsBot: telegramMessages.fromIsBot,
      })
      .from(telegramMessages)
      .where(
        and(
          isNotNull(telegramMessages.text),
          eq(telegramMessages.fromIsBot, false),
          gte(telegramMessages.date, TWO_YEARS_AGO),
        ),
      )
      .orderBy(telegramMessages.date)
      .limit(CHUNK_SIZE)
      .offset(offset);

    if (rows.length === 0) break;

    // Filter through shouldExtractMemory
    const eligible = rows.filter(
      (r) => r.text && shouldExtractMemory(r.text, false),
    );
    const filtered = rows.length - eligible.length;
    skippedFilter += filtered;

    if (filtered > 0) {
      console.log(`[backfill] chunk ${offset}-${offset + rows.length}: ${eligible.length} eligible, ${filtered} filtered out`);
    }

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      batchIndex++;

      try {
        const memories = await extractBatch(batch, batchIndex);
        if (memories.length > 0) {
          const results = await saveMemories(memories);

          for (const result of results) {
            if (result.status === "inserted") {
              extracted++;
            } else if (result.status === "superseded") {
              extracted++;
              superseded++;
              console.log(`[backfill:batch-${batchIndex}]   superseded memory ${result.supersededId} → ${result.id}`);
            } else if (result.status === "skipped_duplicate") {
              skippedDuplicate++;
              console.log(`[backfill:batch-${batchIndex}]   skipped duplicate`);
            }
          }
        }
      } catch (err) {
        batchErrors++;
        console.error(`[backfill:batch-${batchIndex}] FAILED:`, err);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    processed += rows.length;
    offset += rows.length;

    const elapsed = Math.round((performance.now() - startTime) / 1000);
    const rate = processed > 0 ? Math.round((processed / elapsed) * 60) : 0;
    console.log(
      `[backfill] progress: ${processed}/${total} (${Math.round((processed / total) * 100)}%) | extracted: ${extracted} | dupes: ${skippedDuplicate} | superseded: ${superseded} | filtered: ${skippedFilter} | errors: ${batchErrors} | ${elapsed}s elapsed (~${rate} msgs/min)`,
    );
  }

  const totalElapsed = Math.round((performance.now() - startTime) / 1000);
  console.log(`\n[backfill] === COMPLETE ===`);
  console.log(`[backfill] Processed: ${processed} messages in ${totalElapsed}s`);
  console.log(`[backfill] Extracted: ${extracted} memories`);
  console.log(`[backfill] Superseded: ${superseded}`);
  console.log(`[backfill] Skipped (filter): ${skippedFilter}`);
  console.log(`[backfill] Skipped (duplicate): ${skippedDuplicate}`);
  console.log(`[backfill] Parse failures: ${parseFails}`);
  console.log(`[backfill] Batch errors: ${batchErrors}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
