import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { resolveUser } from "../lib/auth";
import { eventsService } from "../../services/events.service";
import { isAppError } from "../../lib/errors";

export const eventsHandler = new Composer<BotContext>();

const SG_DATE = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Singapore",
});

const SG_TIME = new Intl.DateTimeFormat("en-SG", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Singapore",
});

function formatEventDate(date: Date): string {
  return `${SG_DATE.format(date)} · ${SG_TIME.format(date)}`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[\]]/g, "\\$&");
}

function formatVenue(event: { isOnline: boolean | null; venueName?: string | null }): string {
  if (event.isOnline) return "🌐 Online";
  if (event.venueName) return `📍 ${escapeMarkdown(event.venueName)}`;
  return "📍 TBD";
}

function formatCapacity(attendeeCount: number, maxAttendees: number | null): string {
  if (maxAttendees) return `${attendeeCount} / ${maxAttendees} going`;
  return `${attendeeCount} going`;
}

// /events — list upcoming events
eventsHandler.command("events", async (ctx) => {
  const upcoming = await eventsService.listUpcoming(5);

  if (upcoming.length === 0) {
    await ctx.reply(
      "📅 *Upcoming Events*\n\nNo upcoming events right now. Check back soon!",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const lines = ["📅 *Upcoming Events*\n"];
  const keyboard = new InlineKeyboard();

  for (const [i, e] of upcoming.entries()) {
    lines.push(
      `*${i + 1}. ${escapeMarkdown(e.title)}*`,
      `🗓 ${formatEventDate(e.startsAt)}`,
      formatVenue(e),
      `👥 ${formatCapacity(e.attendeeCount, e.maxAttendees)}`,
      "",
    );
    keyboard.text(`RSVP: ${e.title.slice(0, 20)}`, `rsvp:${e.id}`);
    if (i < upcoming.length - 1) keyboard.row();
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

// /rsvp [slug] — RSVP to an event
eventsHandler.command("rsvp", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const resolved = await resolveUser(String(telegramId));
  if (!resolved) {
    await ctx.reply("You need to register first. Send /register to get started.");
    return;
  }

  const slug = ctx.match?.trim();

  // No slug provided — show event picker
  if (!slug) {
    const upcoming = await eventsService.listUpcoming(5);

    if (upcoming.length === 0) {
      await ctx.reply("No upcoming events to RSVP for right now.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const [i, e] of upcoming.entries()) {
      keyboard.text(e.title.slice(0, 40), `rsvp:${e.id}`);
      if (i < upcoming.length - 1) keyboard.row();
    }

    await ctx.reply("Pick an event to RSVP:", { reply_markup: keyboard });
    return;
  }

  // Slug provided — RSVP directly
  try {
    const event = await eventsService.getBySlug(slug);
    await eventsService.rsvp(event.id, resolved.user.id, "going");
    const fresh = await eventsService.getBySlug(slug);

    await ctx.reply(
      `✅ You're going to *${escapeMarkdown(fresh.title)}*!\n👥 ${formatCapacity(fresh.attendeeCount, fresh.maxAttendees)}`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    if (isAppError(err)) {
      const messages: Record<string, string> = {
        EVENT_NOT_FOUND: "Event not found. Check the slug and try again.",
        EVENT_NOT_PUBLISHED: "This event is not open for RSVPs yet.",
        EVENT_FULL: "Sorry, this event is full!",
      };
      await ctx.reply(messages[err.code] ?? err.message);
      return;
    }
    throw err;
  }
});

// Callback query handler for inline RSVP buttons
eventsHandler.callbackQuery(/^rsvp:(.+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCallbackQuery({ text: "Could not identify you.", show_alert: true });
    return;
  }

  const resolved = await resolveUser(String(telegramId));
  if (!resolved) {
    await ctx.answerCallbackQuery({
      text: "You need to register first. Send /register in a private chat.",
      show_alert: true,
    });
    return;
  }

  const eventId = ctx.match?.[1];
  if (!eventId) {
    await ctx.answerCallbackQuery({ text: "Invalid event.", show_alert: true });
    return;
  }

  try {
    const event = await eventsService.getById(eventId);
    await eventsService.rsvp(eventId, resolved.user.id, "going");
    const fresh = await eventsService.getById(eventId);

    await ctx.answerCallbackQuery({ text: `You're going to ${event.title}!` });
    await ctx.reply(
      `✅ *${escapeMarkdown(resolved.user.name ?? "You")}* is going to *${escapeMarkdown(fresh.title)}*!\n👥 ${formatCapacity(fresh.attendeeCount, fresh.maxAttendees)}`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    if (isAppError(err)) {
      const messages: Record<string, string> = {
        EVENT_NOT_FOUND: "Event not found.",
        EVENT_NOT_PUBLISHED: "This event is not open for RSVPs yet.",
        EVENT_FULL: "Sorry, this event is full!",
      };
      await ctx.answerCallbackQuery({
        text: messages[err.code] ?? err.message,
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Something went wrong.", show_alert: true });
    throw err;
  }
});
