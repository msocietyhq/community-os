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

function rowDisplayName(row: TelegramMessageRow): string {
  return row.fromUsername ? `@${row.fromUsername}` : (row.fromFirstName ?? "someone");
}

/** Snippet length for a quoted parent in history. Shorter than REPLY_TEXT_MAX
 *  because a window holds up to 50 messages, roughly half of them replies. */
const HISTORY_REPLY_TEXT_MAX = 80;

function readString(source: object, key: string): string | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(source: object, key: string): number | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function readObject(source: object, key: string): object | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null ? value : undefined;
}

interface ReplyParent {
  name: string;
  date?: number;
  snippet: string;
}

/**
 * Telegram embeds the replied-to message in the update, so the parent is
 * available even when it falls outside the history window — which is the
 * common case: over half of replies target a message more than an hour old.
 */
function parentFromRaw(raw: unknown): ReplyParent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const reply = readObject(raw, "reply_to_message");
  if (!reply) return null;

  const from = readObject(reply, "from");
  const name = from
    ? displayName({
        firstName: readString(from, "first_name") ?? "someone",
        username: readString(from, "username"),
      })
    : "someone";

  const text = readString(reply, "text") ?? readString(reply, "caption") ?? "";

  return {
    name,
    date: readNumber(reply, "date"),
    snippet: text.trim() === "" ? "(non-text message)" : text,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Renders the reply link for a history message.
 *
 * Nearly half of all messages are replies, and inside a forum topic almost
 * every message is. Without this the transcript flattens into a linear list and
 * the model can't tell who is answering whom.
 *
 * When the parent is in the window it is quoted by time only — the full message
 * is already in the transcript at that timestamp. When it isn't, the parent's
 * text is inlined, since the model has no other way to see it.
 */
function formatReplyMarker(
  row: TelegramMessageRow,
  byMessageId: Map<number, TelegramMessageRow>,
): string {
  const parentId = row.replyToMessageId;
  if (parentId === null || parentId === undefined) return "";

  // Telegram sets reply_to_message_id to the topic root for messages that are
  // merely posted in a forum topic rather than replying to anything.
  if (row.messageThreadId !== null && parentId === row.messageThreadId) return "";

  const inWindow = byMessageId.get(parentId);
  if (inWindow) {
    const at = formatTelegramDate(Math.floor(inWindow.date.getTime() / 1000));
    return ` ↳ replying to ${rowDisplayName(inWindow)} at ${at}`;
  }

  const parent = parentFromRaw(row.raw);
  if (!parent) return " ↳ replying to an earlier message";

  const when = parent.date
    ? ` on ${formatTelegramDateFull(parent.date)}, ${formatTelegramDate(parent.date)}`
    : "";

  // The id lets the agent fetch the full text via get_messages when the
  // snippet below is truncated.
  return ` ↳ replying to ${parent.name}${when} (msg ${parentId}): "${truncate(parent.snippet, HISTORY_REPLY_TEXT_MAX)}"`;
}

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
  const byMessageId = new Map(rows.map((r) => [r.messageId, r]));
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
      // Human message — include sender info and who they're replying to
      const name = rowDisplayName(row);
      const time = formatTelegramDate(Math.floor(row.date.getTime() / 1000));
      const dateStr = getDateString(row.date);
      const datePart = dateStr !== lastDateStr ? `${dateStr} ` : "";
      const replyPart = formatReplyMarker(row, byMessageId);
      const content = row.text ?? row.caption ?? (row.mediaType ? `[${row.mediaType}]` : "");
      if (content) {
        messages.push({
          role: "user",
          content: `[${datePart}${time} ${name}${replyPart}]\n${content}`,
        });
      }
    }
    lastDateStr = getDateString(row.date);
  }

  return messages;
}
