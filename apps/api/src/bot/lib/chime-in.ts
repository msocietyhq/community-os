import { aiService } from "../../services/ai.service";

/**
 * Decides whether the bot should answer a message that wasn't addressed to it.
 *
 * The bar is deliberately high. In a 500-member group, a bot that interjects
 * when it wasn't wanted gets muted, and every false positive costs a full
 * agent run — so the design is three gates in series, cheapest first:
 *
 *   1. a free pre-filter that rejects most messages outright,
 *   2. a hard rate limit, independent of any model's opinion,
 *   3. a Haiku judgement with conversation context, defaulting to silence.
 *
 * Anything that isn't clearly a question the bot can actually answer is passed
 * over in silence.
 */

/** Minimum gap between unprompted replies in a chat. */
export const CHIME_IN_COOLDOWN_MS = 30 * 60 * 1000;

/** Below this the model's "yes" is treated as a "no". */
export const CHIME_IN_MIN_CONFIDENCE = 0.8;

/** Messages of surrounding conversation given to the judge. */
export const CHIME_IN_CONTEXT_MESSAGES = 10;

/** Too short to be a real question worth interrupting for. */
const MIN_LENGTH = 20;

/**
 * A message with none of these is almost never a question the bot can help
 * with. Cheap way to drop the bulk of ordinary chat before spending a token.
 */
const QUESTION_SHAPE =
  /\?|\b(anyone|anybody|does\s+\w+\s+know|when('s| is)?|where('s| is)?|who('s| is)?|what('s| is)?|which|how\s+(do|can|many|much)|is\s+there|are\s+there|any\s+(idea|one|body))\b/i;

/**
 * Reasons a message is skipped before any model sees it. Exposed for logging
 * so the gate's behaviour is auditable without turning on the LLM path.
 */
export type SkipReason =
  | "too_short"
  | "command"
  | "from_bot"
  | "mostly_link"
  | "directed_at_person"
  | "not_a_question"
  | "cooldown";

export interface PreFilterInput {
  text: string;
  isBot: boolean;
}

const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * An @mention here is always a human — the bot's own mention is handled as a
 * direct address before this runs. A question put to a named person is theirs
 * to answer, not the bot's.
 */
const MENTIONS_PERSON = /@\w+/;

/** Free rejection pass. Returns null when the message is worth judging. */
export function preFilter({ text, isBot }: PreFilterInput): SkipReason | null {
  if (isBot) return "from_bot";

  const trimmed = text.trim();
  if (trimmed.startsWith("/")) return "command";
  if (MENTIONS_PERSON.test(trimmed)) return "directed_at_person";

  // A shared link with a few words around it is not a question for the bot.
  const withoutLinks = trimmed.replace(URL_PATTERN, " ").trim();
  if (withoutLinks.length < MIN_LENGTH) {
    return trimmed.length === withoutLinks.length ? "too_short" : "mostly_link";
  }

  if (!QUESTION_SHAPE.test(withoutLinks)) return "not_a_question";

  return null;
}

/** True when enough time has passed since the last unprompted reply here. */
export function offCooldown(
  lastChimeAt: number | undefined,
  now: number,
  cooldownMs: number = CHIME_IN_COOLDOWN_MS,
): boolean {
  if (lastChimeAt === undefined) return true;
  return now - lastChimeAt >= cooldownMs;
}

export interface ChimeDecision {
  respond: boolean;
  confidence: number;
  reason: string;
}

/**
 * Parses the judge's reply. Anything malformed, unparseable, or below the
 * confidence floor becomes a "no" — silence is always the safe failure.
 */
export function parseChimeDecision(
  raw: string | undefined,
  minConfidence: number = CHIME_IN_MIN_CONFIDENCE,
): ChimeDecision {
  const silent = (reason: string): ChimeDecision => ({
    respond: false,
    confidence: 0,
    reason,
  });

  if (!raw) return silent("empty response");

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return silent("no json in response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return silent("unparseable json");
  }

  if (typeof parsed !== "object" || parsed === null) return silent("not an object");

  const record = parsed as Record<string, unknown>;
  const respond = record.respond === true;
  const confidence = typeof record.confidence === "number" ? record.confidence : 0;
  const reason = typeof record.reason === "string" ? record.reason : "no reason given";

  if (!respond) return { respond: false, confidence, reason };
  if (confidence < minConfidence) {
    return { respond: false, confidence, reason: `below threshold: ${reason}` };
  }

  return { respond: true, confidence, reason };
}

const JUDGE_PROMPT = `You decide whether a community bot should speak up in a group chat it was NOT addressed in.

The bot serves MSOCIETY, a Singapore community of Muslim tech professionals. It knows about
the community's events, projects, venues, members, reputation scores, and its own chat history.
It can also search the web.

Default to silence. The bar for speaking is high: an unwanted interjection is far worse than a
missed opportunity to help. When in doubt, say no.

Say YES only when ALL of these hold:
- The latest message asks a genuine question, or explicitly asks the group for help.
- The bot can actually answer it from community data or a web lookup.
- Nobody in the recent conversation has already answered it.
- The asker would plainly welcome an answer from a bot.

Say NO — always — for:
- Greetings, banter, jokes, reactions, agreement, thanks
- Opinions, feelings, personal or religious discussion
- Rhetorical questions, or questions aimed at one named person
- Anything already answered in the conversation
- Questions the bot has no way to answer
- Anything you are unsure about

Respond with ONLY a JSON object, no markdown fences:
{"respond": true|false, "confidence": 0.0-1.0, "reason": "<a few words>"}

confidence is how sure you are that speaking up is welcome. Use 0.9+ only when the message is
an unambiguous, unanswered, answerable question.`;

export interface ChimeInInput {
  /** The message being judged. */
  message: string;
  /** Surrounding conversation, oldest first, already formatted for reading. */
  transcript: string;
  chatId: string;
  telegramUserId: number | null;
}

/**
 * Asks the judge. Errors resolve to silence rather than propagating — this
 * runs on ordinary chat traffic and must never disrupt it.
 */
export async function judgeChimeIn(input: ChimeInInput): Promise<ChimeDecision> {
  try {
    const result = await aiService.generateText(
      {
        model: aiService.models.fast,
        system: JUDGE_PROMPT,
        messages: [
          {
            role: "user",
            content: `${input.transcript}\n\nLatest message to judge:\n"${input.message}"`,
          },
        ],
        maxOutputTokens: 128,
      },
      {
        caller: "chime-in-judge",
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
      },
    );

    return parseChimeDecision(result.text);
  } catch (err) {
    console.error("[chime-in] judge failed:", err);
    return { respond: false, confidence: 0, reason: "judge error" };
  }
}

/**
 * Last unprompted reply per chat. In-memory like the photo-sync and
 * auto-register caches: losing it on deploy just means one chat could get an
 * extra interjection, which is not worth a table.
 */
const lastChimeByChat = new Map<string, number>();

export function recordChime(chatId: string, now: number = Date.now()): void {
  lastChimeByChat.set(chatId, now);
}

export function lastChimeAt(chatId: string): number | undefined {
  return lastChimeByChat.get(chatId);
}

/** Test seam — the map is module state. */
export function resetChimeHistory(): void {
  lastChimeByChat.clear();
}
