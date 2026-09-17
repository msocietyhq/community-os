import { encodeXML } from "entities";
import { clip } from "../../lib/text";
import type { ModelMessage } from "ai";
import type { TelegramMeta } from "../types";
import type { ConversationContext } from "./conversation-context";
export {
  HISTORY_MESSAGE_LIMIT,
  HISTORY_WINDOW_MS,
} from "./conversation-context";

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

/** Snippet length for quoted parents in history. */
const HISTORY_REPLY_TEXT_MAX = 80;

/** Flatten and XML-encode a quoted snippet. */
function sanitizeSnippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return clip(encodeXML(flat), max);
}

/** Prevent message content from closing its own XML-like envelope. */
function escapeContent(text: string): string {
  return text.replace(/<\/(msg|quoted)>/gi, "&lt;/$1&gt;");
}

/**
 * Formats a list of DB message rows into a readable transcript for group context.
 */
export function formatGroupHistory(context: ConversationContext): string {
  const lines = context.recentHistory.map(
    (msg) =>
      `<msg id="${msg.id}" from="${encodeXML(msg.from)}" at="${encodeXML(msg.at)}">\n${escapeContent(msg.text)}\n</msg>`,
  );
  return `[Recent group conversation:]\n${lines.join("\n")}\n---`;
}

/**
 * Returns the query string prefixed with a compact context header containing
 * sender info, timestamp, and optional reply chain.
 */
export function buildEnrichedQuery(
  query: string,
  context: ConversationContext,
): string {
  const current = context.currentMessage;
  const parent = context.parentMessage;
  const parentPart = parent
    ? ` | <reply-to-id>${parent.id}</reply-to-id> replying to ${encodeXML(parent.from)} at ${encodeXML(parent.at)}: <quoted>${sanitizeSnippet(parent.text, REPLY_TEXT_MAX)}</quoted>`
    : "";
  const groupPart = context.metadata.isGroupChat
    ? ` | chat_id: ${encodeXML(context.chatId)}`
    : "";
  return `<msg id="${current.id}" from="${encodeXML(current.from)}" at="${encodeXML(current.at)}"${groupPart}>${parentPart}\n${escapeContent(query)}\n</msg>`;
}

/**
 * Merges DB message rows with stored AI SDK context from session into ModelMessage[].
 * Bot messages are enriched with tool call chains from aiResponses when available.
 */
export function buildMessagesFromHistory(
  context: ConversationContext,
  botUserId: number,
  aiResponses: Record<number, ModelMessage[]>,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of context.recentHistory) {
    const isBot =
      message.senderId === botUserId || message.from === String(botUserId);
    const stored = isBot ? aiResponses[message.id] : undefined;
    if (stored?.length) {
      messages.push(...stored);
      continue;
    }
    const parent =
      message.replyToId === context.parentMessage?.id
        ? context.parentMessage
        : context.recentHistory.find(
            (candidate) => candidate.id === message.replyToId,
          );
    const replyTag =
      message.replyToId === undefined
        ? ""
        : `<reply-to-id>${message.replyToId}</reply-to-id>\n`;
    const quoted = parent
      ? `<quoted>${sanitizeSnippet(parent.text, HISTORY_REPLY_TEXT_MAX)}</quoted>\n`
      : "";
    messages.push({
      role: isBot ? "assistant" : "user",
      content: `<msg id="${message.id}" from="${encodeXML(message.from)}" at="${encodeXML(message.at)}">\n${replyTag}${quoted}${escapeContent(message.text)}\n</msg>`,
    });
  }
  return messages;
}
