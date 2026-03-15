import type { Context, SessionFlavor } from "grammy";
import type {
  ConversationFlavor,
  Conversation,
} from "@grammyjs/conversations";
import type { ModelMessage } from "ai";

export interface SessionData {
  chatHistory?: ModelMessage[];
  lastMessageAt?: number; // epoch ms
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<BaseContext>;
export type BotConversation = Conversation<BotContext, BotContext>;
