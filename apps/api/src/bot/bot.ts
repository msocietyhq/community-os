import { Bot } from "grammy";
import { env } from "../env";
import type { BotContext } from "./types";

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

// Enable receiving message reactions
bot.api.config.use((prev, method, payload, signal) => {
  return prev(method, payload, signal);
});
