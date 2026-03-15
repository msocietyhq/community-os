import { Composer } from "grammy";
import type { BotContext } from "../types";

export const helpHandler = new Composer<BotContext>();

helpHandler.command("start", async (ctx) => {
  if (ctx.match === "register") {
    await ctx.conversation.enter("registerConversation");
    return;
  }

  await ctx.reply(
    `Welcome to the MSOCIETY Bot! 🤖\n\n` +
      `I help manage the MSOCIETY community. Here's what I can do:\n\n` +
      `/events — View upcoming events\n` +
      `/rsvp <event> — RSVP to an event\n` +
      `/reputation — Check your reputation score\n` +
      `/register — Set up your community profile\n` +
      `/login — Get a login link for the web portal\n` +
      `/help — Show this help message\n\n` +
      `You can also mention @msocietybot with any question about the community!`,
  );
});

helpHandler.command("help", async (ctx) => {
  await ctx.reply(
    `*MSOCIETY Bot Commands*\n\n` +
      `📅 /events — View upcoming events\n` +
      `✅ /rsvp <event> — RSVP to an event\n` +
      `⭐ /reputation — Check your reputation score\n` +
      `👤 /register — Set up your community profile\n` +
      `🔗 /login — Get a login link for the web portal\n` +
      `❓ /help — Show this help message\n\n` +
      `💬 Mention @msocietybot to ask me anything!`,
    { parse_mode: "Markdown" },
  );
});
