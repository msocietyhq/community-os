import type { ModelMessage } from "ai";
import type { ChatTurn, TelegramMeta } from "../types";
import type { telegramMessages } from "../../db/schema/bot";

export const ONE_HOUR_MS = 60 * 60 * 1000;
export const MAX_HISTORY = 30;

const REPLY_TEXT_MAX = 120;

interface RawMessage {
  message_id: number;
  date: number;
  reply_to_message?: {
    message_id: number;
    date: number;
    from?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    text?: string;
  };
}

interface RawFrom {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/**
 * Builds a TelegramMeta object from a raw grammY message and sender.
 * `meId` is the bot's own Telegram user ID — replies from the bot are omitted.
 */
export function buildTelegramMeta(
  msg: RawMessage,
  from: RawFrom,
  chatType: "private" | "group" | "supergroup",
  meId: number,
): TelegramMeta {
  const meta: TelegramMeta = {
    messageId: msg.message_id,
    date: msg.date,
    from: {
      id: from.id,
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
    },
    chatType,
  };

  const replyMsg = msg.reply_to_message;
  if (replyMsg && replyMsg.from && replyMsg.from.id !== meId) {
    meta.replyTo = {
      messageId: replyMsg.message_id,
      date: replyMsg.date,
      from: {
        id: replyMsg.from.id,
        firstName: replyMsg.from.first_name,
        username: replyMsg.from.username,
      },
      text: replyMsg.text,
    };
  }

  return meta;
}

function formatTelegramDate(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatTelegramDateFull(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayName(from: {
  firstName: string;
  username?: string;
}): string {
  return from.username ? `@${from.username}` : from.firstName;
}

type TelegramMessageRow = typeof telegramMessages.$inferSelect;

/**
 * Formats a list of DB message rows into a readable transcript for group context.
 */
export function formatGroupHistory(messages: TelegramMessageRow[]): string {
  const lines = messages.map((msg) => {
    const time = formatTelegramDate(Math.floor(msg.date.getTime() / 1000));
    const name = msg.fromUsername
      ? `@${msg.fromUsername}`
      : (msg.fromFirstName ?? "unknown");
    const content =
      msg.text ?? msg.caption ?? (msg.mediaType ? `[${msg.mediaType}]` : "[message]");
    return `${time} ${name}: ${content}`;
  });
  return `[Recent group conversation:]\n${lines.join("\n")}\n---`;
}

/**
 * Returns the query string prefixed with a compact context header containing
 * sender info, timestamp, and optional reply chain.
 */
export function buildEnrichedQuery(
  query: string,
  meta: TelegramMeta,
  groupTranscript?: string,
  chatId?: string,
): string {
  const datePart = `${formatTelegramDateFull(meta.date)}, ${formatTelegramDate(meta.date)}`;

  let header: string;

  const senderPart = displayName(meta.from);

  if (meta.replyTo) {
    const replyFrom = meta.replyTo.from
      ? displayName(meta.replyTo.from)
      : "someone";
    const replyTime = formatTelegramDate(meta.replyTo.date);
    let replyText = meta.replyTo.text ?? "(non-text message)";
    if (replyText.length > REPLY_TEXT_MAX) {
      replyText = `${replyText.slice(0, REPLY_TEXT_MAX)}…`;
    }
    header = `[${datePart} | ${senderPart} → replying to ${replyFrom} at ${replyTime}: "${replyText}"${chatId ? ` | chat_id: ${chatId}` : ""}]`;
  } else {
    header = `[${datePart} | ${senderPart}${chatId ? ` | chat_id: ${chatId}` : ""}]`;
  }

  const transcript = groupTranscript ? `${groupTranscript}\n` : "";
  return `${transcript}${header}\n${query}`;
}

/**
 * Filters turns to within the rolling window, flattens messages, and caps to
 * `maxMessages`. Returns both the filtered turns and the flattened history so
 * the caller can compute new-turn messages via `updatedHistory.slice(chatHistory.length)`.
 */
export function getRecentHistory(
  turns: ChatTurn[],
  now: number,
  windowMs: number,
  maxMessages: number,
): { recentTurns: ChatTurn[]; chatHistory: ModelMessage[] } {
  const cutoff = now - windowMs;
  const recentTurns = turns.filter((t) => t.timestamp >= cutoff);

  // Flatten all messages from recent turns
  const allMessages: ModelMessage[] = recentTurns.flatMap((t) => t.messages);

  // Cap to the last maxMessages messages
  const chatHistory =
    allMessages.length > maxMessages
      ? allMessages.slice(allMessages.length - maxMessages)
      : allMessages;

  return { recentTurns, chatHistory };
}
