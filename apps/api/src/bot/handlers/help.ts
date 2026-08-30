import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { resolveUser } from "../lib/auth";
import { eventsService } from "../../services/events.service";
import { isAppError } from "../../lib/errors";
import { helpLines, startLines } from "../commands";

export const helpHandler = new Composer<BotContext>();

helpHandler.command("start", async (ctx) => {
  if (ctx.match === "profile") {
    await ctx.conversation.enter("setProfileConversation");
    return;
  }

  // Where the group-chat /settings reply deep-links to. The menu itself is
  // admin-gated, so this only points the way rather than opening it.
  if (ctx.match === "settings") {
    await ctx.reply("Send /settings here to configure the bot.");
    return;
  }

  const rsvpMatch = ctx.match?.match(/^rsvp_(.+)$/);
  if (rsvpMatch) {
    const eventId = rsvpMatch[1]!;
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const resolved = await resolveUser(String(telegramId));
    if (!resolved) {
      await ctx.reply(
        "You need to set up your profile first. Send /profile to get started.",
      );
      return;
    }

    let event: Awaited<ReturnType<typeof eventsService.getById>>;
    try {
      event = await eventsService.getById(eventId);
    } catch (err) {
      if (isAppError(err) && err.code === "EVENT_NOT_FOUND") {
        await ctx.reply("Event not found.");
        return;
      }
      throw err;
    }

    const keyboard = new InlineKeyboard()
      .text("✅ Going", `rsvp_status:${eventId}:going`)
      .text("🤔 Maybe", `rsvp_status:${eventId}:maybe`)
      .text("❌ Not Going", `rsvp_status:${eventId}:not_going`);

    await ctx.reply(`RSVP to *${event.title.replace(/[_*`[\]]/g, "\\$&")}*:`, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
    return;
  }

  await ctx.reply(
    `Welcome to the MSOCIETY Bot! 🤖\n\n` +
      `I help manage the MSOCIETY community. Here's what I can do:\n\n` +
      `${startLines()}\n\n` +
      `You can also mention @msocietybot with any question about the community!`,
  );
});

helpHandler.command("help", async (ctx) => {
  await ctx.reply(
    `<b>MSOCIETY Bot Commands</b>\n\n` +
      `${helpLines()}\n\n` +
      `💬 Mention @msocietybot to ask me anything!`,
    { parse_mode: "HTML" },
  );
});
