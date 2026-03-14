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

// Start bot
bot.start({
  allowed_updates: [
    "message",
    "callback_query",
    "chat_member",
    "message_reaction",
  ],
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started`);
  },
});
