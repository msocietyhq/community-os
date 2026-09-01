import { encodeXML } from "entities";
import { clip } from "../../lib/text";
import type { ModelMessage } from "ai";
import type { TelegramMeta } from "../types";
import type { telegramMessages } from "../../db/schema/bot";

export const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * How much of a conversation the agent is given, and for how long back.
 *
 * A message leaves the agent's sight when either bound is crossed: it ages past
 * HISTORY_WINDOW_MS, or HISTORY_MESSAGE_LIMIT newer messages push it out. Both
 * are scoped to one chat and one forum topic.
 *
 * Exported because memory extraction batches against them — while a message is
 * still in here the agent can read it directly, so a fact drawn from it is
 * redundant. See `memory-batch.ts`.
 */
export const HISTORY_MESSAGE_LIMIT = 50;
export const HISTORY_WINDOW_MS = ONE_HOUR_MS;

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

function displayName(from: { firstName: string; username?: string }): string {
  return from.username ? `@${from.username}` : from.firstName;
}

type TelegramMessageRow = typeof telegramMessages.$inferSelect;

function rowDisplayName(row: TelegramMessageRow): string {
  return row.fromUsername
    ? `@${row.fromUsername}`
    : (row.fromFirstName ?? "someone");
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
  /** True when the parent lives in another chat and cannot be fetched. */
  external?: boolean;
}

/**
 * Telegram embeds the replied-to message in the update, so the parent is
 * available even when it falls outside the history window — which is the
 * common case: over half of replies target a message more than an hour old.
 *
 * `quote` (the portion the user actually highlighted) wins over the full
 * parent text when present. `external_reply` covers replies to messages in
 * other chats; no such row exists in the corpus yet, so that branch is
 * defensive rather than proven.
 */
function parentFromRaw(raw: unknown): ReplyParent | null {
  if (typeof raw !== "object" || raw === null) return null;

  const reply = readObject(raw, "reply_to_message");
  const external = readObject(raw, "external_reply");
  const source = reply ?? external;
  if (!source) return null;

  const from = readObject(source, "from");
  const name = from
    ? displayName({
        firstName: readString(from, "first_name") ?? "someone",
        username: readString(from, "username"),
      })
    : "someone";

  // A user-selected quote is a better snippet than the whole parent message.
  const quote = readObject(raw, "quote");
  const text =
    (quote ? readString(quote, "text") : undefined) ??
    readString(source, "text") ??
    readString(source, "caption") ??
    "";

  return {
    name,
    date: readNumber(source, "date"),
    snippet: text.trim() === "" ? "(non-text message)" : text,
    external: reply === undefined,
  };
}

/**
 * Flattens a snippet to one line and strips characters that would let user
 * text impersonate the envelope around it.
 */
function sanitizeSnippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return clip(encodeXML(flat), max);
}

/**
 * Neutralises closing tags so message content can't terminate its own envelope.
 * Only the exact closing sequences are touched, so pasted code stays readable.
 */
function escapeContent(text: string): string {
  return text.replace(/<\/(msg|quoted)>/gi, "&lt;/$1&gt;");
}

interface ReplyAttrs {
  attrs: string;
  quoted: string | null;
}

/**
 * Builds the reply attributes for a history message.
 *
 * Nearly half of all messages are replies, and inside a forum topic almost
 * every message is. Without this the transcript flattens into a linear list and
 * the model can't tell who is answering whom.
 *
 * When the parent is in the window it is referenced by time only — the full
 * message is already in the transcript. When it isn't, the parent's text is
 * quoted, since the model has no other way to see it.
 */
function buildReplyAttrs(
  row: TelegramMessageRow,
  byMessageId: Map<number, TelegramMessageRow>,
): ReplyAttrs {
  const none: ReplyAttrs = { attrs: "", quoted: null };

  const parentId = row.replyToMessageId;
  if (parentId === null || parentId === undefined) return none;

  // Telegram sets reply_to_message_id to the topic root for messages that are
  // merely posted in a forum topic rather than replying to anything.
  if (row.messageThreadId !== null && parentId === row.messageThreadId)
    return none;

  const inWindow = byMessageId.get(parentId);
  if (inWindow) {
    const at = formatTelegramDate(Math.floor(inWindow.date.getTime() / 1000));
    return {
      attrs: ` replying-to="${encodeXML(rowDisplayName(inWindow))}" replying-to-at="${at}"`,
      quoted: null,
    };
  }

  const parent = parentFromRaw(row.raw);
  if (!parent) {
    return { attrs: ` replying-to="an earlier message"`, quoted: null };
  }

  const when = parent.date
    ? ` replying-to-at="${formatTelegramDateFull(parent.date)}, ${formatTelegramDate(parent.date)}"`
    : "";

  // The id lets the agent fetch the full text via chat_history when the
  // quote below is truncated. External parents live elsewhere and can't be.
  const ref = parent.external
    ? ` from-another-chat="true"`
    : ` reply-id="${parentId}"`;

  return {
    attrs: ` replying-to="${encodeXML(parent.name)}"${when}${ref}`,
    quoted: sanitizeSnippet(parent.snippet, HISTORY_REPLY_TEXT_MAX),
  };
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
      msg.text ??
      msg.caption ??
      (msg.mediaType ? `[${msg.mediaType}]` : "[message]");
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
      // Human message — sender, timestamp and reply link as envelope
      // attributes, so multi-line or adversarial content can't impersonate
      // the structure around it.
      const name = encodeXML(rowDisplayName(row));
      const time = formatTelegramDate(Math.floor(row.date.getTime() / 1000));
      const dateStr = getDateString(row.date);
      const datePart = dateStr !== lastDateStr ? `${dateStr} ` : "";
      const { attrs, quoted } = buildReplyAttrs(row, byMessageId);
      const content =
        row.text ?? row.caption ?? (row.mediaType ? `[${row.mediaType}]` : "");
      if (content) {
        const quotedLine = quoted ? `<quoted>${quoted}</quoted>\n` : "";
        messages.push({
          role: "user",
          content: `<msg from="${name}" at="${datePart}${time}"${attrs}>\n${quotedLine}${escapeContent(content)}\n</msg>`,
        });
      }
    }
    lastDateStr = getDateString(row.date);
  }

  return messages;
}
