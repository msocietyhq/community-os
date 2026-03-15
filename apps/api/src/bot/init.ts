import { session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { bot } from "./bot";
import { helpHandler } from "./handlers/help";
import { eventsHandler } from "./handlers/events";
import { reputationHandler } from "./handlers/reputation";
import { welcomeHandler } from "./handlers/welcome";
import { aiChatHandler } from "./handlers/ai-chat";
import { tokenHandler } from "./handlers/token";
import { registerHandler } from "./handlers/register";
import { loginHandler } from "./handlers/login";
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
  // Session must be registered before conversations and handlers
  bot.use(session({ initial: () => ({}) }));
  // Conversations plugin must be registered before conversation handlers
  bot.use(conversations());

  // Register handlers
  bot.use(helpHandler);
  bot.use(tokenHandler);
  bot.use(loginHandler);
  bot.use(registerHandler);
  bot.use(eventsHandler);
  bot.use(reputationHandler);
  bot.use(welcomeHandler);
  // aiChatHandler MUST be last — it's a catch-all for @mentions
  bot.use(aiChatHandler);

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  await bot.init();

  const webhookUrl = `${env.API_URL}/api/v1/bot/webhook`;
  await bot.api.setWebhook(webhookUrl, {
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
