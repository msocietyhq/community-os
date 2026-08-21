/**
 * AI-derived member profiles.
 *
 * A member's `ai_*` columns are a derived cache: regenerated wholesale from bot
 * memories and recent messages, overwritten each run, never authoritative. The
 * hand-authored `members` row always wins — see the design spec.
 */
import { z } from "zod";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { members } from "../db/schema/members";
import { user } from "../db/schema/auth";
import { aiService } from "./ai.service";
import { recallMemoriesForSubject } from "./memory.service";
import { getRecentMessagesByUser } from "./messages.service";
import {
  generateEmbedding,
  generateQueryEmbedding,
} from "./embeddings.service";
import { fuseByRRF } from "./reciprocal-rank-fusion";
import { withRetry } from "../lib/retry";
import {
  visibleSuggestions,
  keyedSuggestions,
  type VisibleSuggestions,
  type SuggestionEntry,
} from "./ai-profile-suggestions";
import {
  aiSuggestedSchema,
  type DismissedEntry,
} from "@community-os/shared/validators";

/** How many distilled facts to feed the generator. */
const MEMORY_LIMIT = 50;
/** How many raw messages to feed the generator. */
const MESSAGE_LIMIT = 100;

/**
 * Gap between members during the nightly sweep.
 *
 * Nothing is waiting on this run, so pacing it is free insurance: a second per
 * member keeps even a few-hundred-member sweep well under provider request
 * limits rather than finding them via 429s. Transient failures are still
 * retried with backoff on top of this.
 */
const INTER_MEMBER_DELAY_MS = 1_000;

/** Per-model-call retries inside the AI SDK, beneath our own outer retry. */
const MODEL_MAX_RETRIES = 3;

/**
 * New messages required before raw chat alone triggers a regeneration.
 *
 * Any *memory* is high-signal — they're distilled facts and rare (single digits
 * per week across the whole community), so one is enough. Raw messages are the
 * opposite: without a threshold, a member who says "salam" costs a Sonnet call
 * that night to rewrite near-identical prose.
 */
const MIN_NEW_MESSAGES = 10;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cosine floor below which a member is not a match at all.
 *
 * Without a floor, `searchSemantic` returns the nearest neighbour however
 * distant it is — "rust systems programming" would confidently name someone who
 * has never touched Rust, because they were the closest of the candidates.
 *
 * `recall-calibration.getSimilarityFloor()` is deliberately NOT reused here: it
 * derives its floor from the `bot_memories` corpus, which is one-line facts.
 * Member summaries are multi-sentence prose, and their scores distribute lower.
 * Measured against a real generated summary:
 *
 *   0.503  "mosque community technology"      true match
 *   0.435  "product design and gamification"  true match
 *   0.277  "cybersecurity job opportunities"  noise
 *   0.150  "underwater basket weaving"        noise
 *   0.142  "rust systems programming"         noise
 *
 * The memory floor at the time was 0.482 — high enough to reject the 0.435 true
 * match. 0.35 sits in the gap between the two clusters.
 *
 * This is measured on a thin sample. Once a decent number of members have
 * profiles, this should be calibrated from the corpus the way
 * `recall-calibration.ts` does for memories rather than left as a constant.
 */
export const MEMBER_SIMILARITY_FLOOR = 0.35;

const generationSchema = z.object({
  summary: z
    .string()
    .describe(
      "2-4 sentences describing this person's work, expertise and current " +
        "interests. Matched against questions like 'who knows about X'. " +
        "Read only by the AI, never shown to anyone.",
    ),
  suggested: aiSuggestedSchema,
});

const GENERATION_PROMPT = `You build a search profile for a member of MSOCIETY, a community of Muslim tech professionals.

You are given facts the community bot has recorded about one person, plus their recent messages. Produce two things:

1. \`summary\` — 2-4 sentences capturing what this person works on, what they know well, and what they're currently interested in. This text is embedded and matched against questions like "who here knows about cybersecurity?". Write it for retrieval: name concrete technologies, companies, domains and roles rather than generic praise. No hedging, no meta-commentary.

2. \`suggested\` — candidate values for their public profile fields. These are SUGGESTIONS the member may accept or reject, never assertions of fact. Only include a field when the evidence is clear and specific. Omit anything you are guessing at.

Rules:
- Use only what the evidence supports. Do not invent employers, titles or skills.
- \`bio\` must be written in the member's own voice, first person, max 500 characters.
- \`skills\` and \`interests\` are short tags (e.g. "Postgres", "Arabic NLP"), not sentences.
- If the evidence is too thin for a useful summary, return an empty string for \`summary\` and an empty object for \`suggested\`.`;

export interface GenerationResult {
  status: "generated" | "skipped-no-telegram" | "skipped-no-evidence";
}

interface ScoredMember {
  userId: string;
  score: number;
}

/** Cosine search over the summary embedding. */
async function searchSemantic(
  query: string,
  limit: number,
): Promise<ScoredMember[]> {
  const embedding = await generateQueryEmbedding(query);
  const vectorLiteral = `[${embedding.join(",")}]`;

  return db
    .select({
      userId: members.userId,
      score:
        sql<number>`1 - (${members.aiEmbedding} <=> ${vectorLiteral}::vector)`.as(
          "score",
        ),
    })
    .from(members)
    .where(
      and(
        isNotNull(members.aiEmbedding),
        sql`1 - (${members.aiEmbedding} <=> ${vectorLiteral}::vector) > ${MEMBER_SIMILARITY_FLOOR}`,
      ),
    )
    .orderBy(sql`${members.aiEmbedding} <=> ${vectorLiteral}::vector`)
    .limit(limit);
}

/**
 * Exact-token search over the summary.
 *
 * Uses the dedicated members_ai_summary_fts_idx rather than members_search_idx:
 * the BM25 index backs the public `q` parameter, and indexing AI-derived text
 * there would make public search results depend on it.
 */
async function searchLexical(
  query: string,
  limit: number,
): Promise<ScoredMember[]> {
  return db
    .select({
      userId: members.userId,
      score: sql<number>`ts_rank(
        to_tsvector('simple', coalesce(${members.aiSummary}, '')),
        plainto_tsquery('simple', ${query})
      )`.as("score"),
    })
    .from(members)
    .where(
      sql`to_tsvector('simple', coalesce(${members.aiSummary}, '')) @@ plainto_tsquery('simple', ${query})`,
    )
    .orderBy(sql`score DESC`)
    .limit(limit);
}

/**
 * Stamp `ai_generated_at` without writing a profile.
 *
 * Called when a member is skipped, so the staleness predicate treats them as
 * up to date. Without this they stay `ai_generated_at IS NULL` and are picked
 * up again every single night — and a member whose evidence is too thin for a
 * summary would burn a model call on every one of those runs. They still come
 * back the moment genuinely new evidence lands, because the predicate compares
 * against this timestamp.
 */
export interface SweepResult {
  generated: number;
  skipped: number;
  failed: number;
}

/**
 * Run a list of members through generation: paced, retried, fault-isolated.
 *
 * Shared by the boot backfill and the monthly sweep — they differ only in which
 * members they select.
 */
async function processMembers(
  userIds: string[],
  label: string,
): Promise<SweepResult> {
  console.log(`[ai-profile] ${label}: ${userIds.length} member(s)`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, userId] of userIds.entries()) {
    // Each member is one model call plus one embedding, and nothing is waiting
    // on the result — a second between members keeps even a whole-community run
    // comfortably under provider request limits instead of finding them via 429s.
    if (index > 0) await sleep(INTER_MEMBER_DELAY_MS);

    try {
      const result = await withRetry(
        () => aiProfileService.generateForMember(userId),
        {
          onRetry: ({ attempt, delayMs, error }) => {
            console.warn(
              `[ai-profile] ${userId} attempt ${attempt} failed, retrying in ${Math.round(delayMs / 1000)}s:`,
              (error as Error)?.message,
            );
          },
        },
      );
      if (result.status === "generated") generated++;
      else skipped++;
    } catch (err) {
      // One member's failure must not abandon the rest of the run.
      console.error(`[ai-profile] gave up on ${userId}:`, err);
      failed++;
    }

    if ((index + 1) % 25 === 0) {
      console.log(`[ai-profile] ${label}: ${index + 1}/${userIds.length}`);
    }
  }

  console.log(
    `[ai-profile] ${label} complete — ${generated} generated, ${skipped} skipped, ${failed} failed`,
  );
  return { generated, skipped, failed };
}

async function markGenerated(userId: string): Promise<void> {
  await db
    .update(members)
    .set({ aiGeneratedAt: new Date() })
    .where(eq(members.userId, userId));
}

export const aiProfileService = {
  /**
   * Rebuild one member's AI profile from scratch and overwrite their columns.
   *
   * Idempotent: same evidence in, same columns out. There is no incremental
   * merge — regeneration replaces.
   */
  async generateForMember(userId: string): Promise<GenerationResult> {
    const [account] = await db
      .select({ telegramId: user.telegramId, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!account?.telegramId) return { status: "skipped-no-telegram" };

    const telegramId = Number(account.telegramId);

    const [memories, messages] = await Promise.all([
      recallMemoriesForSubject(telegramId, MEMORY_LIMIT),
      getRecentMessagesByUser(telegramId, MESSAGE_LIMIT),
    ]);

    if (memories.length === 0 && messages.length === 0) {
      await markGenerated(userId);
      return { status: "skipped-no-evidence" };
    }

    const evidence = [
      `Member: ${account.name}`,
      "",
      "## Recorded facts",
      ...(memories.length
        ? memories.map((m) => `- ${m.content} (confidence ${m.confidence})`)
        : ["(none)"]),
      "",
      "## Recent messages",
      ...(messages.length ? messages.map((m) => `- ${m.text}`) : ["(none)"]),
    ].join("\n");

    const result = await aiService.generateObject(
      {
        model: aiService.models.smart,
        schema: generationSchema,
        system: GENERATION_PROMPT,
        messages: [{ role: "user", content: evidence }],
        maxRetries: MODEL_MAX_RETRIES,
      },
      { caller: "ai-profile-generation" },
    );

    // `aiService.generateObject` widens its result to `unknown` (its return type
    // drops generateObject's generic), so re-parse to recover the type. The SDK
    // has already validated against the same schema, making this cheap.
    const object = generationSchema.parse(result.object);

    if (!object.summary.trim()) {
      await markGenerated(userId);
      return { status: "skipped-no-evidence" };
    }

    const embedding = await generateEmbedding(object.summary);

    await db
      .update(members)
      .set({
        aiSummary: object.summary,
        aiSuggested: object.suggested,
        aiEmbedding: embedding,
        aiGeneratedAt: new Date(),
      })
      .where(eq(members.userId, userId));

    return { status: "generated" };
  },

  /**
   * Find members whose generated summary matches a free-text need.
   *
   * Hybrid: cosine over the summary's embedding for meaning, Postgres FTS over
   * the summary text for literals (company names, acronyms, product names that
   * a cosine search smears into a neighbourhood). Fused on rank, since the two
   * scores aren't on comparable scales.
   *
   * Returns user IDs only, best match first — the caller joins to what it needs.
   */
  async searchByContext(query: string, limit = 5): Promise<string[]> {
    const [semantic, lexical] = await Promise.all([
      searchSemantic(query, limit * 2),
      searchLexical(query, limit * 2).catch(() => [] as ScoredMember[]),
    ]);

    return fuseByRRF([semantic, lexical], (m) => m.userId, limit).map(
      (m) => m.userId,
    );
  },

  /** Suggestions worth showing this member, already filtered. */
  async visibleSuggestionsFor(userId: string): Promise<VisibleSuggestions> {
    const [row] = await db
      .select({
        aiSuggested: members.aiSuggested,
        aiDismissed: members.aiDismissed,
        bio: members.bio,
        skills: members.skills,
        interests: members.interests,
        currentCompany: members.currentCompany,
        currentTitle: members.currentTitle,
        education: members.education,
      })
      .from(members)
      .where(eq(members.userId, userId))
      .limit(1);

    if (!row) return {};

    return visibleSuggestions(
      row.aiSuggested ?? null,
      {
        bio: row.bio,
        skills: row.skills,
        interests: row.interests,
        currentCompany: row.currentCompany,
        currentTitle: row.currentTitle,
        education: row.education,
      },
      row.aiDismissed ?? [],
    );
  },

  /** Suggestions for this member, filtered and keyed for an API client. */
  async keyedSuggestionsFor(userId: string): Promise<SuggestionEntry[]> {
    return keyedSuggestions(
      await aiProfileService.visibleSuggestionsFor(userId),
    );
  },

  /**
   * Record dismissal keys, stamped now.
   *
   * Appends rather than replaces, and de-duplicates by key keeping the newest
   * timestamp so re-dismissing refreshes the TTL.
   */
  async recordDismissals(userId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;

    const [row] = await db
      .select({ aiDismissed: members.aiDismissed })
      .from(members)
      .where(eq(members.userId, userId))
      .limit(1);

    const at = new Date().toISOString();
    const merged = new Map<string, DismissedEntry>();
    for (const entry of row?.aiDismissed ?? []) merged.set(entry.key, entry);
    for (const key of keys) merged.set(key, { key, at });

    await db
      .update(members)
      .set({ aiDismissed: [...merged.values()] })
      .where(eq(members.userId, userId));
  },

  /**
   * Regenerate every member whose evidence has moved since their last run.
   *
   * Sequential on purpose: this is a nightly background sweep over a community
   * of tens, and each member costs one Claude call plus one embedding. Running
   * them in parallel would spike spend and rate limits for no wall-clock benefit
   * anyone is waiting on.
   */
  /**
   * Generate for members who have never had a profile built.
   *
   * Runs on boot so a deploy picks up anyone new. Self-limiting: `markGenerated`
   * stamps every member it touches, including the ones it skips, so the very
   * first run does the whole community and every run after it finds only
   * genuinely new joiners — usually none.
   */
  async backfillMissing(): Promise<SweepResult> {
    const rows = await db.execute<{ user_id: string }>(sql`
      SELECT m.user_id
      FROM ${members} m
      JOIN "user" u ON m.user_id = u.id
      WHERE u.telegram_id IS NOT NULL
        AND m.ai_generated_at IS NULL
    `);

    if (rows.length === 0) {
      console.log("[ai-profile] backfill: nothing to do");
      return { generated: 0, skipped: 0, failed: 0 };
    }

    return processMembers(
      rows.map((r) => r.user_id),
      "backfill",
    );
  },

  /**
   * Regenerate members whose evidence has moved since their last run.
   *
   * Runs monthly. Without the evidence check this would pay for a model call
   * and an embedding per member per run to rewrite identical text.
   */
  async regenerateStale(): Promise<SweepResult> {
    // `user.telegram_id` is text while `subject_telegram_id` and `from_user_id`
    // are bigint, so every comparison is cast to text. Casting the bigint side
    // down rather than the text side up: a non-numeric telegram_id would make
    // `u.telegram_id::bigint` throw for the whole query.
    const rows = await db.execute<{ user_id: string }>(sql`
      SELECT m.user_id
      FROM ${members} m
      JOIN "user" u ON m.user_id = u.id
      WHERE u.telegram_id IS NOT NULL
        AND (
          m.ai_generated_at IS NULL
          OR EXISTS (
            SELECT 1 FROM bot_memories bm
            WHERE bm.subject_telegram_id::text = u.telegram_id
              AND bm.superseded_by IS NULL
              AND bm.created_at > m.ai_generated_at
          )
          OR (
            SELECT count(*) FROM telegram_messages tm
            WHERE tm.from_user_id::text = u.telegram_id
              AND tm.date > m.ai_generated_at
          ) >= ${MIN_NEW_MESSAGES}
        )
    `);

    if (rows.length === 0) {
      console.log("[ai-profile] monthly sweep: no members with new evidence");
      return { generated: 0, skipped: 0, failed: 0 };
    }

    return processMembers(
      rows.map((r) => r.user_id),
      "monthly sweep",
    );
  },
};
