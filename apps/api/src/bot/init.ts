import { session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { bot } from "./bot";
import { helpHandler } from "./handlers/help";
import { eventsHandler } from "./handlers/events";
import { projectsHandler } from "./handlers/projects";
import { reputationHandler } from "./handlers/reputation";
import { digestHandler } from "./handlers/digest";
import { startDigestScheduler, stopDigestScheduler } from "./lib/digest-scheduler";
import { aiChatHandler } from "./handlers/ai-chat";
import { tokenHandler } from "./handlers/token";
import { profileHandler } from "./handlers/profile";
import { loginHandler } from "./handlers/login";
import { usageHandler } from "./handlers/usage";
import { modelsHandler } from "./handlers/models";
import { telegramCommands } from "./commands";
import { settingsHandler } from "./handlers/settings";
import { dmAccessMiddleware } from "./lib/dm-gate";
import { groupAccessMiddleware } from "./lib/group-gate";
import { PostgresSessionStorage } from "./session-storage";
import { membershipMiddleware, warmUpKnownIds } from "./lib/auto-register";
import { photoSyncMiddleware } from "./lib/photo-sync";
import { telegramMessageLoggerMiddleware } from "./lib/telegram-message-logger";
import { env } from "../env";

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "chat_member",
  "my_chat_member",
] as const;

/**
 * Initialize the Telegram bot: register handlers, init bot info,
 * and start long polling.
 */
export async function initBot(): Promise<void> {
  if (!env.TELEGRAM_GROUP_ID) {
    console.warn(
      "TELEGRAM_GROUP_ID not set — the bot will stay in, and answer, any group or channel it is added to",
    );
  }

  // Leave (and ignore) every chat that isn't the community group, before
  // anything else touches the update.
  bot.use(groupAccessMiddleware);

  // Gate DMs before anything else touches them — a blocked stranger should not
  // cause a photo fetch, a logged message, or a session write.
  bot.use(dmAccessMiddleware);

  // Auto-reply to the triggering message in group chats
  bot.use(async (ctx, next) => {
    if (
      (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") &&
      ctx.message
    ) {
      const originalReply = ctx.reply.bind(ctx);
      const messageId = ctx.message.message_id;
      ctx.reply = (text, other) =>
        originalReply(text, {
          ...other,
          reply_parameters: other?.reply_parameters ?? {
            message_id: messageId,
          },
        });
    }
    return next();
  });

  // Log all messages to DB for group context (after group guard)
  bot.use(telegramMessageLoggerMiddleware);
  // Auto-register group members before session/handlers
  bot.use(membershipMiddleware);
  // Sync profile photo on any interaction (at most once per 24h)
  bot.use(photoSyncMiddleware);

  // Session must be registered before conversations and handlers
  bot.use(session({ initial: () => ({}), storage: new PostgresSessionStorage() }));
  // Conversations plugin must be registered before conversation handlers
  bot.use(conversations());

  // Register handlers
  bot.use(helpHandler);
  bot.use(tokenHandler);
  bot.use(loginHandler);
  bot.use(profileHandler);
  bot.use(eventsHandler);
  bot.use(projectsHandler);
  bot.use(reputationHandler);
  bot.use(digestHandler);
  bot.use(usageHandler);
  bot.use(modelsHandler);
  bot.use(settingsHandler);
  // aiChatHandler MUST be last — it's a catch-all for @mentions
  bot.use(aiChatHandler);

  // Error handling
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  await warmUpKnownIds();
  await bot.init();

  // Publishes the "/" autocomplete menu. Fire-and-forget: Telegram rejects the
  // whole call if any entry is malformed (commands.test.ts guards the format),
  // and a menu that failed to update must never stop the bot from starting.
  // Two scopes: groups get the commands that work there, DMs get everything.
  // Fire-and-forget — Telegram rejects the whole call if any entry is
  // malformed (commands.test.ts guards the format), and a menu that failed to
  // update must never stop the bot from starting.
  Promise.all([
    bot.api.setMyCommands(telegramCommands(false)),
    bot.api.setMyCommands(telegramCommands(true), {
      scope: { type: "all_private_chats" },
    }),
  ]).catch((err) => console.error("Failed to publish command menu:", err));

  // Start long polling (fire-and-forget — resolves only when bot stops)
  bot.start({ allowed_updates: [...ALLOWED_UPDATES] }).catch((err) => {
    console.error("Bot polling error:", err);
  });

  startDigestScheduler();

  console.log(`Bot @${bot.botInfo.username} initialized`);
}

/**
 * Gracefully stop the bot (stop long polling).
 */
export async function shutdownBot(): Promise<void> {
  stopDigestScheduler();
  await bot.stop();
}
