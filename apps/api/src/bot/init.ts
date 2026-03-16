import { session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { bot } from "./bot";
import { helpHandler } from "./handlers/help";
import { eventsHandler } from "./handlers/events";
import { reputationHandler } from "./handlers/reputation";
import { membershipHandler } from "./handlers/membership";
import { aiChatHandler } from "./handlers/ai-chat";
import { tokenHandler } from "./handlers/token";
import { registerHandler } from "./handlers/register";
import { loginHandler } from "./handlers/login";
import { PostgresSessionStorage } from "./session-storage";
import { autoRegisterMiddleware, warmUpKnownIds } from "./lib/auto-register";
import { photoSyncMiddleware } from "./lib/photo-sync";
import { cleanupStaleAuthors } from "./lib/message-cache";
import { env } from "../env";

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "chat_member",
  "my_chat_member",
  "message_reaction",
] as const;

/**
 * Initialize the Telegram bot: register handlers, init bot info,
 * and set up the webhook. Call this after the HTTP server is listening.
 */
export async function initBot(): Promise<void> {
  // Auto-leave unauthorized groups when bot is added
  const allowedGroupId = env.TELEGRAM_GROUP_ID;
  bot.on("my_chat_member", async (ctx) => {
    const chatId = ctx.myChatMember.chat.id;
    const chatType = ctx.myChatMember.chat.type;
    if (
      allowedGroupId &&
      (chatType === "group" || chatType === "supergroup") &&
      String(chatId) !== allowedGroupId
    ) {
      await ctx.api.leaveChat(chatId);
    }
  });

  // Group guard: drop updates from unauthorized groups
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (
      allowedGroupId &&
      (chatType === "group" || chatType === "supergroup") &&
      String(ctx.chat!.id) !== allowedGroupId
    ) {
      return; // silently drop
    }
    await next();
  });

  // Auto-register group members before session/handlers
  bot.use(autoRegisterMiddleware);
  // Sync profile photo in private chats (at most once per 24h)
  bot.use(photoSyncMiddleware);

  // Session must be registered before conversations and handlers
  bot.use(session({ initial: () => ({}), storage: new PostgresSessionStorage() }));
  // Conversations plugin must be registered before conversation handlers
  bot.use(conversations());

  // Register handlers
  bot.use(helpHandler);
  bot.use(tokenHandler);
  bot.use(loginHandler);
  bot.use(registerHandler);
  bot.use(eventsHandler);
  bot.use(reputationHandler);
  bot.use(membershipHandler);
  // aiChatHandler MUST be last — it's a catch-all for @mentions
  bot.use(aiChatHandler);

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  await warmUpKnownIds();
  await bot.init();

  // Delete webhook first to reset Telegram's delivery state.
  // After failed deliveries (e.g. during deployment downtime),
  // Telegram backs off and may stop sending updates entirely.
  // Re-registering the same URL via setWebhook alone doesn't reset this.
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  const webhookUrl = `${env.API_URL}/api/v1/bot/webhook`;
  await bot.api.setWebhook(webhookUrl, {
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: [...ALLOWED_UPDATES],
  });

  // Periodically clean up stale message author rows (every hour)
  setInterval(cleanupStaleAuthors, 60 * 60 * 1000);

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
