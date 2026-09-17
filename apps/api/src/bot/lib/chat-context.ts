import { encodeXML } from "entities";
import { clip } from "../../lib/text";
import type { ModelMessage } from "ai";
import type { TelegramMeta } from "../types";
import type { telegramMessages } from "../../db/schema/bot";
import type { ConversationContext } from "./conversation-context";
export { HISTORY_MESSAGE_LIMIT, HISTORY_WINDOW_MS } from "./conversation-context";

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
 */
export function buildTelegramMeta(
  msg: RawMessage,
  from: RawFrom,
  chatType: "private" | "group" | "supergroup",
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
  if (replyMsg?.from) {
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
export function formatGroupHistory(context: ConversationContext): string {
  const lines = context.recentHistory.map((msg) => `<msg id="${msg.id}" from="${encodeXML(msg.from)}" at="${encodeXML(msg.at)}">\n${escapeContent(msg.text)}\n</msg>`);
  return `[Recent group conversation:]\n${lines.join("\n")}\n---`;
}

/**
 * Returns the query string prefixed with a compact context header containing
 * sender info, timestamp, and optional reply chain.
 */
export function buildEnrichedQuery(query: string, context: ConversationContext): string {
  const current = context.currentMessage;
  const parent = context.parentMessage;
  const parentPart = parent ? ` | <reply-to-id>${parent.id}</reply-to-id> replying to ${encodeXML(parent.from)} at ${encodeXML(parent.at)}: <quoted>${sanitizeSnippet(parent.text, REPLY_TEXT_MAX)}</quoted>` : "";
  const groupPart = context.metadata.isGroupChat ? ` | chat_id: ${encodeXML(context.chatId)}` : "";
  return `<msg id="${current.id}" from="${encodeXML(current.from)}" at="${encodeXML(current.at)}"${groupPart}>${parentPart}\n${escapeContent(query)}\n</msg>`;
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
export function buildMessagesFromHistory(context: ConversationContext, botUserId: number, aiResponses: Record<number, ModelMessage[]>): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of context.recentHistory) {
    const isBot = message.senderId === botUserId || message.from === String(botUserId);
    const stored = isBot ? aiResponses[message.id] : undefined;
    if (stored?.length) { messages.push(...stored); continue; }
    const parent = message.replyToId === context.parentMessage?.id ? context.parentMessage : context.recentHistory.find((candidate) => candidate.id === message.replyToId);
    const replyTag = message.replyToId === undefined ? "" : `<reply-to-id>${message.replyToId}</reply-to-id>\n`;
    const quoted = parent ? `<quoted>${sanitizeSnippet(parent.text, HISTORY_REPLY_TEXT_MAX)}</quoted>\n` : "";
    messages.push({ role: isBot ? "assistant" : "user", content: `<msg id="${message.id}" from="${encodeXML(message.from)}" at="${encodeXML(message.at)}">\n${replyTag}${quoted}${escapeContent(message.text)}\n</msg>` });
  }
  return messages;
}
