import type { Context, SessionFlavor } from "grammy";
import type {
  ConversationFlavor,
  Conversation,
} from "@grammyjs/conversations";
import type { ModelMessage } from "ai";
import type { PendingQuestion } from "./lib/pending-question";

export interface TelegramMeta {
  messageId: number;
  date: number; // Telegram Unix timestamp (seconds)
  from: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
  };
  replyTo?: {
    messageId: number;
    date: number;
    from?: { id: number; firstName: string; username?: string };
    text?: string;
  };
  chatType: "private" | "group" | "supergroup";
}

export interface SessionData {
  // Maps bot message_id → AI SDK response messages (tool calls, results, assistant text)
  aiResponses?: Record<number, ModelMessage[]>;
  /**
   * An outstanding ask_user question. Sessions are keyed per chat, so there is
   * one slot per chat — the asked member is recorded so someone else replying
   * doesn't consume it.
   */
  pendingQuestion?: PendingQuestion;
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<BaseContext>;
export type BotConversation = Conversation<BotContext, BotContext>;
