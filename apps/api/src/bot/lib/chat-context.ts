import type { ModelMessage } from "ai";
import type { TelegramMeta } from "../types";
import type { telegramMessages } from "../../db/schema/bot";

export const ONE_HOUR_MS = 60 * 60 * 1000;

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
 * `meId` is the bot's own Telegram user ID — used to tag replies to the bot.
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
  if (replyMsg && replyMsg.from) {
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

  return `${header}\n${query}`;
}

function getDateString(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Merges DB message rows with stored AI SDK context from session into ModelMessage[].
 * Bot messages are enriched with tool call chains from aiResponses when available.
 * Includes the date only when it differs from the previous message's date.
 */
export function buildMessagesFromHistory(
  rows: TelegramMessageRow[],
  botUserId: number,
  aiResponses: Record<number, ModelMessage[]>,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let lastDateStr = "";

  for (const row of rows) {
    if (row.fromUserId === botUserId) {
      // Bot message — use stored AI context if available
      const stored = aiResponses[row.messageId];
      if (stored && stored.length > 0) {
        messages.push(...stored);
      } else if (row.text) {
        messages.push({ role: "assistant", content: row.text });
      }
    } else {
      // Human message — include sender info
      const name = row.fromUsername ? `@${row.fromUsername}` : (row.fromFirstName ?? "someone");
      const time = formatTelegramDate(Math.floor(row.date.getTime() / 1000));
      const dateStr = getDateString(row.date);
      const datePart = dateStr !== lastDateStr ? `${dateStr} ` : "";
      const content = row.text ?? row.caption ?? (row.mediaType ? `[${row.mediaType}]` : "");
      if (content) {
        messages.push({ role: "user", content: `[${datePart}${time} ${name}]\n${content}` });
      }
    }
    lastDateStr = getDateString(row.date);
  }

  return messages;
}
