import type { Context, SessionFlavor } from "grammy";
import type {
  ConversationFlavor,
  Conversation,
} from "@grammyjs/conversations";

export interface SessionData {
  // Session data for conversation state
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<BaseContext>;
export type BotConversation = Conversation<BotContext, BotContext>;
