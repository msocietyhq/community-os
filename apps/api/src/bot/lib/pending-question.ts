/**
 * Lets a member answer the bot's question without addressing the bot.
 *
 * In a group the handler only runs on an @mention or a reply, so a plain
 * follow-up is dropped. `ask_user` sends its question with force_reply, which
 * usually routes the answer back — but a member who ignores the reply prompt
 * and just types would otherwise be talking into the void.
 *
 * Deliberately deterministic: no model decides whether to listen. The bot
 * listens only to the member it just asked, in the same thread, briefly.
 */

export interface PendingQuestion {
  /** The bot message carrying the question. */
  questionMessageId: number;
  /** Who was asked. Another member answering does not resume. */
  askedTelegramId: number;
  /** Epoch ms, for expiry. */
  askedAt: number;
  /** Forum topic the question was asked in, or null for General. */
  messageThreadId: number | null;
}

/**
 * How long an unanswered question keeps the floor open.
 *
 * Long enough to read and type an answer; short enough that a stale question
 * can't hijack an unrelated message later in the day.
 */
export const PENDING_QUESTION_TTL_MS = 5 * 60 * 1000;

export interface IncomingMessage {
  fromTelegramId: number | null;
  messageThreadId: number | null;
  at: number;
}

/**
 * Should this message be treated as an answer to the outstanding question?
 *
 * All four must hold: a question is outstanding, it was put to this member,
 * it was asked in this thread, and it hasn't expired.
 */
export function shouldResume(
  pending: PendingQuestion | undefined,
  incoming: IncomingMessage,
  ttlMs: number = PENDING_QUESTION_TTL_MS,
): boolean {
  if (!pending) return false;
  if (incoming.fromTelegramId === null) return false;
  if (incoming.fromTelegramId !== pending.askedTelegramId) return false;
  if (incoming.messageThreadId !== pending.messageThreadId) return false;

  const age = incoming.at - pending.askedAt;
  return age >= 0 && age <= ttlMs;
}

/** True once the question can no longer be resumed and should be dropped. */
export function isExpired(
  pending: PendingQuestion | undefined,
  now: number,
  ttlMs: number = PENDING_QUESTION_TTL_MS,
): boolean {
  if (!pending) return false;
  return now - pending.askedAt > ttlMs;
}
