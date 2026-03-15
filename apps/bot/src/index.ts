import { bot } from "./bot";
import { welcomeHandler } from "./handlers/welcome";
import { reputationHandler } from "./handlers/reputation";
import { aiChatHandler } from "./handlers/ai-chat";
import { eventsHandler } from "./handlers/events";
import { helpHandler } from "./handlers/help";
import { env } from "./env";

// Register handlers
bot.use(helpHandler);
bot.use(eventsHandler);
bot.use(reputationHandler);
bot.use(welcomeHandler);
bot.use(aiChatHandler);

// Error handling
bot.catch((err) => {
  console.error("Bot error:", err);
});

const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "chat_member",
  "message_reaction",
] as const;

// Init bot and start HTTP server
await bot.init();
const { app } = await import("./server");

// Retry setWebhook — tunnel DNS may not be resolvable by Telegram immediately
for (let attempt = 1; attempt <= 15; attempt++) {
  try {
    await bot.api.setWebhook(env.WEBHOOK_URL, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    break;
  } catch (err) {
    if (attempt === 15) throw err;
    console.log(`setWebhook attempt ${attempt}/15 failed, retrying in 3s...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
console.log(`Bot @${bot.botInfo.username} running on port ${env.PORT}`);

const shutdown = async () => {
  console.log("Shutting down...");
  await app.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
