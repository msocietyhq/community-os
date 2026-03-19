/**
 * One-off script to backfill past events from Telegram messages.
 *
 * Uses hybrid search to find event-related messages, then Claude to extract
 * structured event data.
 *
 * Usage:
 *   bun run --cwd apps/api src/scripts/backfill-events.ts
 *   DRY_RUN=true bun run --cwd apps/api src/scripts/backfill-events.ts
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "../db";
import { events } from "../db/schema/events";
import { searchMessagesHybrid, type MessageSearchResult } from "../services/messages.service";

const DRY_RUN = process.env.DRY_RUN === "true";
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

if (!TELEGRAM_GROUP_ID) {
  console.error("TELEGRAM_GROUP_ID env var is required");
  process.exit(1);
}

const SEARCH_QUERIES = [
  "community meetup event",
  "workshop session learning",
  "hackathon build",
  "gathering social hangout",
  "talk presentation speaker",
  "iftar dinner",
  "coding session pair programming",
  "event this saturday sunday weekend",
  "join us RSVP",
  "online virtual session zoom",
];

const RESULTS_PER_QUERY = 50;
const BATCH_SIZE = 20;
const MIN_TEXT_LENGTH = 20;

const extractedEventSchema = z.object({
  events: z.array(
    z.object({
      title: z.string().describe("Short, descriptive event title"),
      description: z.string().optional().describe("Brief event description"),
      eventType: z
        .enum(["meetup", "workshop", "hackathon", "talk", "social", "other"])
        .describe("Type of event"),
      startsAt: z.string().describe("ISO 8601 datetime for event start"),
      endsAt: z.string().optional().describe("ISO 8601 datetime for event end"),
      isOnline: z.boolean().describe("Whether the event is online"),
      onlineUrl: z.string().optional().describe("URL for online event"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("Confidence that this is an actual event"),
      sourceMessageIds: z
        .array(z.number())
        .describe("Message IDs that reference this event"),
    }),
  ),
});

type ExtractedEvent = z.infer<typeof extractedEventSchema>["events"][number];

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

function getMessageContent(msg: MessageSearchResult): string {
  return [msg.text, msg.caption].filter(Boolean).join(" ");
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

function sameDate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

// Step 1: Search for event-related messages
async function searchMessages(): Promise<MessageSearchResult[]> {
  console.log("=== Step 1: Searching for event-related messages ===");
  const seen = new Map<number, MessageSearchResult>();

  for (const query of SEARCH_QUERIES) {
    const results = await searchMessagesHybrid(TELEGRAM_GROUP_ID!, query, RESULTS_PER_QUERY);
    for (const msg of results) {
      if (!seen.has(msg.messageId) && getMessageContent(msg).length >= MIN_TEXT_LENGTH) {
        seen.set(msg.messageId, msg);
      }
    }
    console.log(`  "${query}" -> ${results.length} results (${seen.size} unique total)`);
  }

  const messages = [...seen.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  console.log(`\nCandidate messages after dedup + filter: ${messages.length}`);
  return messages;
}

// Step 2: Extract events via Claude
async function extractEvents(messages: MessageSearchResult[]): Promise<ExtractedEvent[]> {
  console.log("\n=== Step 2: Extracting events via Claude ===");
  const anthropic = createAnthropic();
  const allEvents: ExtractedEvent[] = [];

  const batches: MessageSearchResult[][] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    batches.push(messages.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    console.log(`  Processing batch ${i + 1}/${batches.length} (${batch.length} messages)...`);

    const formattedMessages = batch
      .map(
        (msg) =>
          `[ID: ${msg.messageId}] [Date: ${msg.date.toISOString()}] [From: ${msg.fromFirstName ?? msg.fromUsername ?? "unknown"}]\n${getMessageContent(msg)}`,
      )
      .join("\n\n---\n\n");

    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-20250514"),
      schema: extractedEventSchema,
      system: `You are analyzing Telegram group chat messages from a Muslim tech professionals community (MSOCIETY) to extract information about past events.

Instructions:
- Only extract ACTUAL events (meetups, workshops, talks, socials, etc.), not general discussion about events
- Use the message date as context for relative date references like "this Saturday" or "next Friday"
- If multiple messages reference the same event, consolidate them into one event entry and include all relevant message IDs
- For event titles, create a clear descriptive title (e.g. "MSOCIETY Monthly Meetup - March 2025")
- Assess your confidence: "high" = clear event with date/time, "medium" = likely event but some details inferred, "low" = uncertain
- If no events are found in the messages, return an empty events array`,
      prompt: `Extract structured event data from these Telegram messages:\n\n${formattedMessages}`,
    });

    allEvents.push(...object.events);
    console.log(`    Extracted ${object.events.length} events from batch`);
  }

  console.log(`\nTotal events extracted: ${allEvents.length}`);
  return allEvents;
}

// Step 3: Deduplicate
async function deduplicateEvents(
  extracted: ExtractedEvent[],
): Promise<{ events: ExtractedEvent[]; crossBatchDupes: number; existingSkipped: number }> {
  console.log("\n=== Step 3: Deduplicating ===");

  // Cross-batch dedup: same date + normalized title
  const uniqueMap = new Map<string, ExtractedEvent>();
  let crossBatchDupes = 0;

  for (const evt of extracted) {
    const key = `${evt.startsAt.slice(0, 10)}::${normalizeTitle(evt.title)}`;
    const existing = uniqueMap.get(key);
    if (existing) {
      crossBatchDupes++;
      const confidenceRank = { high: 3, medium: 2, low: 1 };
      if (confidenceRank[evt.confidence] > confidenceRank[existing.confidence]) {
        uniqueMap.set(key, evt);
      }
    } else {
      uniqueMap.set(key, evt);
    }
  }

  console.log(`  Cross-batch duplicates removed: ${crossBatchDupes}`);

  // Check against existing DB events
  const existingEvents = await db
    .select({ title: events.title, startsAt: events.startsAt })
    .from(events);

  let existingSkipped = 0;
  const final: ExtractedEvent[] = [];

  for (const evt of uniqueMap.values()) {
    const isDuplicate = existingEvents.some(
      (existing) =>
        existing.startsAt &&
        sameDate(existing.startsAt.toISOString(), evt.startsAt) &&
        normalizeTitle(existing.title).includes(normalizeTitle(evt.title).slice(0, 20)),
    );
    if (isDuplicate) {
      existingSkipped++;
    } else {
      final.push(evt);
    }
  }

  console.log(`  Already existing (skipped): ${existingSkipped}`);
  console.log(`  Events to insert: ${final.length}`);

  return { events: final, crossBatchDupes, existingSkipped };
}

// Step 4: Insert events
async function insertEvents(
  extracted: ExtractedEvent[],
): Promise<{ created: number; completed: number; published: number; errors: number }> {
  console.log("\n=== Step 4: Inserting events ===");
  const now = new Date();
  let created = 0;
  let completed = 0;
  let published = 0;
  let errors = 0;

  for (const evt of extracted) {
    try {
      const startsAt = new Date(evt.startsAt);
      const status = startsAt < now ? "completed" : "published";

      if (DRY_RUN) {
        console.log(
          `  [DRY RUN] Would create: "${evt.title}" (${evt.eventType}, ${status}, ${evt.startsAt})`,
        );
        created++;
        if (status === "completed") completed++;
        else published++;
        continue;
      }

      await db.insert(events).values({
        title: evt.title,
        slug: generateSlug(evt.title),
        description: evt.description ?? null,
        eventType: evt.eventType,
        status,
        isOnline: evt.isOnline,
        onlineUrl: evt.onlineUrl ?? null,
        startsAt,
        endsAt: evt.endsAt ? new Date(evt.endsAt) : null,
        createdBy: null,
      });

      created++;
      if (status === "completed") completed++;
      else published++;
      console.log(`  Created: "${evt.title}" (${status})`);
    } catch (err) {
      errors++;
      console.error(`  Error inserting "${evt.title}":`, err);
    }
  }

  return { created, completed, published, errors };
}

// Main
async function main() {
  console.log(DRY_RUN ? "*** DRY RUN MODE — no events will be inserted ***\n" : "");

  const messages = await searchMessages();
  if (messages.length === 0) {
    console.log("No candidate messages found. Exiting.");
    return;
  }

  const allExtracted = await extractEvents(messages);

  // Filter to high + medium confidence only
  const highMedium = allExtracted.filter((e) => e.confidence !== "low");
  const lowCount = allExtracted.length - highMedium.length;
  console.log(`\nFiltered: ${highMedium.length} high/medium confidence, ${lowCount} low (skipped)`);

  const { events: toInsert, crossBatchDupes, existingSkipped } =
    await deduplicateEvents(highMedium);

  const { created, completed, published, errors } = await insertEvents(toInsert);

  // Step 5: Summary
  const highCount = allExtracted.filter((e) => e.confidence === "high").length;
  const medCount = allExtracted.filter((e) => e.confidence === "medium").length;

  console.log(`
=== Backfill Events Summary ===
Candidate messages: ${messages.length}
Events extracted: ${allExtracted.length} (${highCount} high, ${medCount} medium, ${lowCount} low/skipped)
Cross-batch duplicates removed: ${crossBatchDupes}
Already existing (skipped): ${existingSkipped}
Created: ${created} (${completed} completed, ${published} published)
Errors: ${errors}
${DRY_RUN ? "\n*** DRY RUN — nothing was actually inserted ***" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
