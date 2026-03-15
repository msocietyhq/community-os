import { bot } from "./bot";
import { helpHandler } from "./handlers/help";
import { eventsHandler } from "./handlers/events";
import { reputationHandler } from "./handlers/reputation";
import { welcomeHandler } from "./handlers/welcome";
import { aiChatHandler } from "./handlers/ai-chat";
import { tokenHandler } from "./handlers/token";
import { env } from "../env";

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "chat_member",
  "message_reaction",
] as const;

/**
 * Initialize the Telegram bot: register handlers, init bot info,
 * and set up the webhook. Call this after the HTTP server is listening.
 */
export async function initBot(): Promise<void> {
  // Register handlers
  bot.use(helpHandler);
  bot.use(tokenHandler);
  bot.use(eventsHandler);
  bot.use(reputationHandler);
  bot.use(welcomeHandler);
  bot.use(aiChatHandler);

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  await bot.init();

  await bot.api.setWebhook(env.WEBHOOK_URL, {
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: [...ALLOWED_UPDATES],
  });

  console.log(`Bot @${bot.botInfo.username} initialized`);
}

/**
 * Gracefully shut down the bot (delete webhook).
 */
export async function shutdownBot(): Promise<void> {
  try {
    await bot.api.deleteWebhook();
  } catch {
    // Best-effort cleanup
  }
}
