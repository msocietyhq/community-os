import type { Context, SessionFlavor } from "grammy";
import type {
  ConversationFlavor,
  Conversation,
} from "@grammyjs/conversations";
import type { ModelMessage } from "ai";

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

export interface ChatTurn {
  timestamp: number; // epoch ms (our system time, for rolling window)
  meta?: TelegramMeta; // present on user-initiated turns; absent on bot turns
  messages: ModelMessage[]; // user message + tool call steps + assistant response
}

export interface SessionData {
  chatTurns?: ChatTurn[];
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<BaseContext>;
export type BotConversation = Conversation<BotContext, BotContext>;
