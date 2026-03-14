import { Composer } from "grammy";
import type { BotContext } from "../types";
import { apiClient } from "../lib/api-client";

export const eventsHandler = new Composer<BotContext>();

eventsHandler.command("events", async (ctx) => {
  // TODO: Fetch upcoming events from API
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

  // TODO: RSVP via API
  await ctx.reply(`RSVP functionality coming soon for: ${args}`);
});
