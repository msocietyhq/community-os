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
import {
  generationSchema,
  unwrapCollapsedProfile,
} from "./ai-profile-unwrap";

// Re-exported so the service stays the single import surface for callers.
export { generationSchema, unwrapCollapsedProfile };

/** How many distilled facts to feed the generator. */
const MEMORY_LIMIT = 50;
/** How many raw messages to feed the generator. */
const MESSAGE_LIMIT = 100;

/** Nothing waits on the sweep, so pace it well clear of provider rate limits. */
const INTER_MEMBER_DELAY_MS = 1_000;

/** Per-model-call retries inside the AI SDK, beneath our own outer retry. */
const MODEL_MAX_RETRIES = 3;

/**
 * Bump when the prompt or evidence format changes — profiles below this version
 * are stale, so the next backfill rebuilds them once and then goes quiet.
 * Evidence moving is not the only reason a profile is out of date.
 */
const PROMPT_VERSION = 3;

/**
 * New messages needed before chat alone triggers a regeneration. Raw messages
 * are noisy, and without a threshold one "salam" costs a model call to rewrite
 * the same prose.
 */
const MIN_NEW_MESSAGES = 10;

/**
 * New recorded facts needed before memories alone trigger a regeneration.
 *
 * This was effectively 1 (an EXISTS), on the stated grounds that memories are
 * distilled and rare. They are not rare: the extractor runs on every message
 * clearing its pre-filter and routinely writes several facts from one message.
 * Nine of the fourteen members swept on 2026-09-01 were selected by four or
 * fewer memories that largely restated what their profile already said.
 *
 * Set against the twice-monthly sweep: halving the window roughly halves how
 * long a member's new evidence waits, which on its own would raise the number
 * of regenerations per month. This holds the total flat.
 */
const MIN_NEW_MEMORIES = 5;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * True when the model hand-wrote its JSON into the summary field rather than
 * filling it. Rare now the prompt no longer describes JSON, but embedding that
 * text would silently poison the search corpus.
 */
function looksLikeSerialisedJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cosine floor below which a member isn't a match. Without one, search returns
 * the nearest neighbour however distant — naming someone for "rust" who has
 * never touched it.
 *
 * Not `recall-calibration.getSimilarityFloor()`: that's derived from
 * `bot_memories`, which is one-line facts. Member summaries are prose and score
 * lower — measured true matches at 0.435-0.503 against noise below 0.28, where
 * the memory floor sat at 0.482 and would have rejected a real match.
 *
 * Measured on a thin sample; worth calibrating from the corpus once enough
 * members have profiles.
 */
export const MEMBER_SIMILARITY_FLOOR = 0.35;

const GENERATION_PROMPT = `You build a search profile for a member of MSOCIETY, a community of Muslim tech professionals.

You are given facts the community bot has recorded about one person, plus their recent messages. Produce two things:

1. \`summary\` — 2-4 sentences capturing what this person works on, what they know well, and what they're currently interested in. This text is embedded and matched against questions like "who here knows about cybersecurity?". Write it for retrieval: name concrete technologies, companies, domains and roles rather than generic praise. No hedging, no meta-commentary.

2. \`suggested\` — candidate values for their public profile fields. These are SUGGESTIONS the member may accept or reject, never assertions of fact. Only include a field when the evidence is clear and specific. Omit anything you are guessing at.

Each memory carries a category. Only \`person_fact\` is a claim *about* this person — the rest (\`technical\`, \`general\`, \`decision\`, \`event_related\`, \`community_preference\`, \`opinion\`) record something they discussed, decided or attended. Roughly 7 in 10 memories are not \`person_fact\`, so this distinction matters:
- \`summary\`: use everything. What someone repeatedly discusses is the strongest signal for "who here knows about X" — a member who keeps bringing up CI infrastructure should match a question about CI, whether or not anyone recorded it as a fact about them. Attribute it honestly: "often discusses X", not "works on X".
- \`suggested\`: use \`person_fact\` only. A technical memory about a company's architecture is not evidence the member works there. Never turn a topic they discussed into an employer, title or bio claim.

Rules:
- Use only what the evidence supports. Do not invent employers, titles or skills.
- \`bio\` must be written in the member's own voice, first person, max 500 characters.
- \`skills\` and \`interests\` are short tags (e.g. "Postgres", "Arabic NLP"), not sentences.
- Many members have barely spoken. If there is not enough evidence to say anything useful about someone, leave the summary blank and suggest nothing. That is a perfectly good answer — do not pad it out with generic filler.

Every line of evidence is dated \`[YYYY-MM-DD]\`, and today's date is given. Much of this community's history is old, so weigh it:
- Where two pieces of evidence conflict, the newer one wins. Someone who mentioned joining a company later than they mentioned leaving another works at the later one.
- Facts that change — employer, job title, what they're currently building — should reflect the most recent evidence, not the most frequent.
- Facts that don't change much — domains they know, languages they speak, long-running projects — can draw on older evidence freely.
- If the only support for a changeable fact is more than a year old, leave it out of \`suggested\` rather than asserting it as current. It can still inform \`summary\`, phrased as past ("worked on X in 2025") rather than present.`;

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
 * Stamp `ai_generated_at` for a skipped member, so the staleness predicate
 * treats them as current. Without it they're re-selected every run, burning a
 * model call each time. New evidence still brings them back.
 */
export interface SweepResult {
  generated: number;
  skipped: number;
  failed: number;
}

/** Paced, retried, fault-isolated. Shared by the boot backfill and monthly sweep. */
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
    .set({ aiGeneratedAt: new Date(), aiPromptVersion: PROMPT_VERSION })
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

    // Every line is dated. Without dates the model can't tell a fact recorded
    // last week from one recorded two years ago — it can't prefer the newer of
    // two conflicting claims, and it states stale facts as current. Most of the
    // corpus is old: roughly half of all active memories are 90+ days old, and
    // three quarters of members last posted over a year ago.
    const evidence = [
      `Member: ${account.name}`,
      `Today: ${isoDate(new Date())}`,
      "",
      "## Recorded memories (newest first)",
      ...(memories.length
        ? memories.map(
            (m) =>
              `- [${isoDate(m.createdAt)}] (${m.category}, confidence ${m.confidence}) ${m.content}`,
          )
        : ["(none)"]),
      "",
      "## Messages (newest first)",
      ...(messages.length
        ? messages.map((m) => `- [${isoDate(m.date)}] ${m.text}`)
        : ["(none)"]),
    ].join("\n");

    const result = await aiService.generateObject(
      {
        schema: generationSchema,
        system: GENERATION_PROMPT,
        messages: [{ role: "user", content: evidence }],
        maxRetries: MODEL_MAX_RETRIES,
      },
      // `fast` (Haiku), not `smart` (Sonnet). Sonnet is 3x the rate on both
      // input and output for a job that is one-shot structured summarisation,
      // and the whole-community sweep is the largest single line in the AI
      // budget. Set here rather than by repointing `ai.model.smart`, which is
      // shared with chime-in turns, tech-news and the digest.
      { caller: "ai-profile-generation", tier: "fast", class: "background" },
    );

    // `aiService.generateObject` widens its result to `unknown` (its return type
    // drops generateObject's generic), so re-parse to recover the type. The SDK
    // has already validated against the same schema, making this cheap.
    const object = generationSchema.parse(result.object);

    if (!object.summary.trim() || looksLikeSerialisedJson(object.summary)) {
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
        aiPromptVersion: PROMPT_VERSION,
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
        AND (
          m.ai_generated_at IS NULL
          OR m.ai_prompt_version < ${PROMPT_VERSION}
        )
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
   * Runs twice a month. Without the evidence check this would pay for a model call
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
          OR m.ai_prompt_version < ${PROMPT_VERSION}
          OR (
            SELECT count(*) FROM bot_memories bm
            WHERE bm.subject_telegram_id::text = u.telegram_id
              AND bm.superseded_by IS NULL
              AND bm.created_at > m.ai_generated_at
          ) >= ${MIN_NEW_MEMORIES}
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
