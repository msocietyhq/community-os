import { Composer } from "grammy";
import type { BotContext } from "../types";

export const eventsHandler = new Composer<BotContext>();

eventsHandler.command("events", async (ctx) => {
  // TODO: Call events service directly to fetch upcoming events
  await ctx.reply(
    "📅 *Upcoming Events*\n\nNo upcoming events right now. Check back soon!",
    { parse_mode: "Markdown" }
  );
});

eventsHandler.command("rsvp", async (ctx) => {
  const args = ctx.match;
  if (!args) {
    await ctx.reply("Usage: /rsvp <event-slug>");
    return;
  }

  // TODO: Call events service directly to RSVP
  await ctx.reply(`RSVP functionality coming soon for: ${args}`);
});
