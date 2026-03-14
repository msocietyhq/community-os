import type { Context, SessionFlavor } from "grammy";

export interface SessionData {
  // Session data for conversation state
}

export type BotContext = Context & SessionFlavor<SessionData>;
