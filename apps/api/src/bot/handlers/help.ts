import { Composer } from "grammy";
import type { BotContext } from "../types";

export const helpHandler = new Composer<BotContext>();

helpHandler.command("start", async (ctx) => {
  await ctx.reply(
    `Welcome to the MSOCIETY Bot! 🤖\n\n` +
      `I help manage the MSOCIETY community. Here's what I can do:\n\n` +
      `/events — View upcoming events\n` +
      `/rsvp <event> — RSVP to an event\n` +
      `/reputation — Check your reputation score\n` +
      `/register — Set up your community profile\n` +
      `/help — Show this help message\n\n` +
      `You can also mention @msocietybot with any question about the community!`
  );
});

helpHandler.command("help", async (ctx) => {
  await ctx.reply(
    `*MSOCIETY Bot Commands*\n\n` +
      `📅 /events — View upcoming events\n` +
      `✅ /rsvp <event> — RSVP to an event\n` +
      `⭐ /reputation — Check your reputation score\n` +
      `👤 /register — Set up your community profile\n` +
      `❓ /help — Show this help message\n\n` +
      `💬 Mention @msocietybot to ask me anything!`,
    { parse_mode: "Markdown" }
  );
});

helpHandler.command("register", async (ctx) => {
  // TODO: Generate registration link to web portal
  await ctx.reply(
    `To complete your registration, visit the community portal:\n\n` +
      `🔗 https://hub.msociety.dev\n\n` +
      `Log in with your Telegram account to set up your profile.`
  );
});
