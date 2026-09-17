import { session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { run, sequentialize, type RunnerHandle } from "@grammyjs/runner";
import { bot } from "./bot";
import { concurrencyKey } from "./lib/concurrency";
import { helpHandler } from "./handlers/help";
import { eventsHandler } from "./handlers/events";
import { projectsHandler } from "./handlers/projects";
import { reputationHandler } from "./handlers/reputation";
import { digestHandler } from "./handlers/digest";
import {
  startDigestScheduler,
  stopDigestScheduler,
} from "./lib/digest-scheduler";
import { flushAllConversations } from "./lib/memory-batch";
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
import { reapOrphanedComputerExecs } from "./ai/computer-reaper";
import { logComputerRuntimeDeps } from "./ai/ssh-bin";

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "chat_member",
  "my_chat_member",
] as const;

/** Set while long polling; cleared after a graceful stop. */
let runner: RunnerHandle | undefined;

/**
 * Initialize the Telegram bot: register handlers, init bot info,
 * and start concurrent long polling.
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

  // Same-chat updates stay ordered so session writes cannot race. Other chats
  // run in parallel — a long computer turn must not stall a DM.
  bot.use(sequentialize(concurrencyKey));
  // Session must be registered before conversations and handlers
  bot.use(
    session({
      initial: () => ({}),
      getSessionKey: concurrencyKey,
      storage: new PostgresSessionStorage(),
    }),
  );
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

  // Concurrent long polling (fire-and-forget — the handle resolves on stop)
  runner = run(bot, {
    runner: { fetch: { allowed_updates: [...ALLOWED_UPDATES] } },
  });
  runner.task()?.catch((err) => {
    console.error("Bot polling error:", err);
  });

  startDigestScheduler();

  logComputerRuntimeDeps();

  // Crash leftovers on the computer: hangup is ignored so a timed-out exec
  // outlives our SSH, and a restart would otherwise leave them until the
  // 10-minute timeout. Fire-and-forget — a missing host must not block polling.
  reapOrphanedComputerExecs().catch((err) => {
    console.error("[computer] exec reaper failed:", err);
  });

  console.log(`Bot @${bot.botInfo.username} initialized`);
}

/**
 * Gracefully stop the bot (stop long polling).
 */
export async function shutdownBot(): Promise<void> {
  stopDigestScheduler();
  // Buffered runs are safe to lose — unflushed messages are unstamped, so the
  // backfill reads them on the next boot. Flushing here just spares it the
  // work, and keeps a redeploy from delaying a fact by the whole window.
  await flushAllConversations().catch((err) => {
    console.error("[memory-batch] shutdown flush failed:", err);
  });
  if (runner) {
    await runner.stop();
    runner = undefined;
  }
}
