import { z } from "zod";

/**
 * Notices when conversation in a Telegram forum topic has drifted off that
 * topic's subject for long enough to be worth a reminder.
 *
 * A different judgement from chime-in.ts (whether to answer a question
 * nobody asked the bot), but built the same way: a free pre-filter, a hard
 * per-topic cooldown independent of any model's opinion, then a cheap model
 * judgement on each message that clears the filter. Where chime-in gates a
 * single yes/no on confidence, this gates a running streak — only N
 * *consecutive* off-topic messages, past cooldown, produce a reminder. A
 * single on-topic message breaks the streak, and so does a merely doubtful
 * one — the same way chime-in's confidence gate treats an unsure "yes" as a
 * "no", `applyDriftConfidenceGate` treats an unsure "off-topic" as on-topic,
 * and it costs the streak exactly as a real on-topic message would. The one
 * exception is a judge failure: `judgeTopicDrift` (topic-drift-judge.ts)
 * returns null rather than a decision when the model call itself fails, and
 * a null carries no information about whether the topic actually came back
 * on subject — the caller leaves a build-up streak untouched rather than
 * advancing or resetting it. A missed reminder costs nothing; a wrong one
 * reads as the bot policing a 500-member group.
 */

/** Below this the judge's "off-topic" is treated as "on-topic". */
export const TOPIC_DRIFT_MIN_CONFIDENCE = 0.8;

/** Messages of surrounding conversation given to the judge. */
export const TOPIC_DRIFT_CONTEXT_MESSAGES = 6;

/**
 * Too short to carry a judgeable subject either way. Lower than chime-in's
 * floor: chime-in is filtering for question shape, this only needs to rule
 * out bare reactions ("lol", "same") before spending a token on them.
 */
const MIN_LENGTH = 8;

export type DriftSkipReason = "too_short" | "command" | "from_bot";

export interface DriftPreFilterInput {
  text: string;
  isBot: boolean;
}

/**
 * Free rejection pass. Returns null when the message is worth judging.
 *
 * Deliberately knows nothing about the topic's name — that's a DB lookup,
 * and this exists precisely so ordinary traffic that fails one of these
 * free, sync checks never pays for it. The caller checks the topic name
 * separately, after this passes.
 */
export function preFilter({
  text,
  isBot,
}: DriftPreFilterInput): DriftSkipReason | null {
  if (isBot) return "from_bot";

  const trimmed = text.trim();
  if (trimmed.startsWith("/")) return "command";
  if (trimmed.length < MIN_LENGTH) return "too_short";

  return null;
}

/** Key for the per-topic state below — one chat can have many topics. */
export function topicKey(chatId: string, threadId: number): string {
  return `${chatId}:${threadId}`;
}

export interface DriftDecision {
  offTopic: boolean;
  confidence: number;
  reason: string;
}

/**
 * The judge's verdict, enforced by the SDK.
 *
 * No `.min()`/`.max()` on `confidence`, for the same reason as
 * chime-in.ts's `chimeDecisionSchema`: Anthropic's structured output rejects
 * `minimum`/`maximum` on numbers. The gate below compares against a
 * threshold rather than relying on the schema to bound the value.
 */
export const driftDecisionSchema = z.object({
  offTopic: z.boolean(),
  confidence: z
    .number()
    .describe(
      "How sure the latest message has drifted from the topic's subject, 0-1. 0.9+ only for an unambiguous departure.",
    ),
  reason: z.string().describe("A few words"),
});

/**
 * Apply the confidence threshold to a verdict.
 *
 * Separate from the model call so the gate is testable without one, and so
 * an "off-topic" the judge wasn't sure about doesn't advance the streak.
 */
export function applyDriftConfidenceGate(
  decision: DriftDecision,
  minConfidence: number = TOPIC_DRIFT_MIN_CONFIDENCE,
): DriftDecision {
  if (!decision.offTopic) return decision;
  // `>= minConfidence` rather than `< minConfidence`, so a non-finite value
  // fails the gate — see chime-in.ts's `applyConfidenceGate` for why.
  if (!(decision.confidence >= minConfidence)) {
    return {
      offTopic: false,
      confidence: decision.confidence,
      reason: `below threshold: ${decision.reason}`,
    };
  }
  return decision;
}

export const JUDGE_PROMPT = `You decide whether a single message in a Telegram forum topic has drifted off that topic's stated subject.

You are given the topic's subject and the latest message, plus a little surrounding conversation for context — a short reply like "lol true" or "same here" is on-topic if what it's replying to was on-topic.

Say YES (drifted) only when the latest message is a genuine departure from the topic's subject — a different subject being discussed, not a related tangent, a joke, or a passing aside.

Say NO — always — for:
- Anything plausibly related to the topic's subject, even loosely
- Reactions, banter, agreement, thanks, emoji-only replies
- Logistics and admin chatter (who's coming, links, scheduling) about the topic's own subject
- A single off-hand remark that isn't developing into its own conversation
- Anything you are unsure about

confidence is how sure you are the message has drifted. Use 0.9+ only when the departure is unambiguous — a member reading the topic's name would agree the message doesn't belong there.`;

export interface TopicDriftInput {
  /** The message being judged. */
  message: string;
  /** Surrounding conversation, oldest first, already formatted for reading. */
  transcript: string;
  /** The topic's Telegram name. */
  topicName: string;
  chatId: string;
  telegramUserId: number | null;
  /**
   * Confidence floor, from topicDrift.minConfidence. Applied by
   * judgeTopicDrift and nowhere else, for the same reason as chime-in's
   * ChimeInInput.minConfidence: gating twice would silently use whichever is
   * stricter.
   */
  minConfidence?: number;
}

// ── Per-topic streak and cooldown state ────────────────────

/**
 * Consecutive off-topic verdicts per topic, and the last time a reminder
 * was sent. In-memory like chime-in's `lastChimeByChat` — losing it on
 * deploy just means one topic could take a few extra messages to notice
 * drift again, which is not worth a table.
 */
const streakByTopic = new Map<string, number>();
const lastReminderByTopic = new Map<string, number>();

export function currentStreak(key: string): number {
  return streakByTopic.get(key) ?? 0;
}

/** Advances the streak for an off-topic verdict. Returns the new count. */
export function recordOffTopic(key: string): number {
  const next = currentStreak(key) + 1;
  streakByTopic.set(key, next);
  return next;
}

/** An on-topic verdict breaks the streak — drift has to be consecutive. */
export function resetStreak(key: string): void {
  streakByTopic.delete(key);
}

/** A reminder was sent: starts the cooldown and clears the streak. */
export function recordReminder(key: string, now: number = Date.now()): void {
  lastReminderByTopic.set(key, now);
  resetStreak(key);
}

export function lastReminderAt(key: string): number | undefined {
  return lastReminderByTopic.get(key);
}

/** Test seam — the maps are module state. */
export function resetDriftHistory(): void {
  streakByTopic.clear();
  lastReminderByTopic.clear();
}

/** Fills the `{topic}` placeholder in a configured reminder template. */
export function renderReminder(template: string, topicName: string): string {
  return template.replaceAll("{topic}", topicName);
}
