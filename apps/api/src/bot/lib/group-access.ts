import type { Chat, ChatMember } from "grammy/types";
import { isPresentChatMember } from "../../lib/telegram-membership";

/**
 * Which chats the bot is willing to sit in — the testable core.
 *
 * The bot serves exactly one community group. Anyone can add a Telegram bot to
 * any group or channel they administer, so "added somewhere else" is not an
 * error case, it is the normal behaviour of a public bot username: the guard
 * that acts on this decision is what keeps the bot from quietly serving a chat
 * nobody here controls.
 *
 * Deliberately free of database, env and grammY-runtime imports so it can be
 * tested without any of them, mirroring the dm-access / dm-gate split. The
 * middleware that gathers these facts lives in group-gate.ts.
 */

export interface GroupAccessInput {
  /** The community group's chat id, or undefined when it isn't configured. */
  allowedChatId: string | undefined;
  chatId: number | string;
  chatType: Chat["type"];
  /**
   * The bot's own membership in that chat, when the update carries it — only
   * `my_chat_member` does. Absent for ordinary messages.
   */
  botMember?: ChatMember;
}

export type GroupAccessDecision =
  | {
      leave: false;
      reason: "private" | "own_group" | "unconfigured" | "already_out";
    }
  | { leave: true; reason: "foreign_chat" };

/**
 * Decides whether the bot should walk out of the chat an update came from.
 *
 * Channels count as foreign chats too. A bot added to a channel is added as an
 * administrator, so ignoring channels would leave the bot holding posting
 * rights in someone else's broadcast.
 *
 * Returns `already_out` for the `my_chat_member` update that arrives when the
 * bot is removed from a foreign chat — the status change we caused ourselves
 * by leaving, and the one somebody else caused by kicking us. Calling
 * `leaveChat` on a chat the bot is no longer in only produces an API error.
 */
export function decideGroupAccess({
  allowedChatId,
  chatId,
  chatType,
  botMember,
}: GroupAccessInput): GroupAccessDecision {
  if (chatType === "private") return { leave: false, reason: "private" };

  // Nothing to compare against: with no configured group, "foreign" has no
  // meaning and leaving would walk out of the real group too. initBot logs a
  // warning at startup so this is visible rather than silently permissive.
  if (!allowedChatId) return { leave: false, reason: "unconfigured" };

  if (String(chatId) === allowedChatId) {
    return { leave: false, reason: "own_group" };
  }

  if (botMember && !isPresentChatMember(botMember)) {
    return { leave: false, reason: "already_out" };
  }

  return { leave: true, reason: "foreign_chat" };
}

// ── Leave attempt throttling ────────────────────────────────

/**
 * In-memory, like the DM denial cooldown. Losing it on deploy costs at most
 * one extra `leaveChat` call per foreign chat, which is not worth a table.
 *
 * Its job is the backlog case: when the `my_chat_member` update is missed and
 * the bot only notices where it is from ordinary traffic, a group that has been
 * chatting for a while delivers a burst of buffered messages, and each one
 * would otherwise fire its own leave call.
 */
const LEAVE_RETRY_MS = 5 * 60 * 1000;
const lastAttemptedAt = new Map<string, number>();

export function shouldAttemptLeave(
  chatId: number | string,
  now: number = Date.now(),
): boolean {
  const key = String(chatId);
  const last = lastAttemptedAt.get(key);
  if (last !== undefined && now - last < LEAVE_RETRY_MS) return false;
  lastAttemptedAt.set(key, now);
  return true;
}

/** Test seam — the map is module state. */
export function resetLeaveAttempts(): void {
  lastAttemptedAt.clear();
}
