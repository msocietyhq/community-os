import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { resolveUser } from "../lib/auth";
import { eventsService } from "../../services/events.service";
import { isAppError } from "../../lib/errors";
import { env } from "../../env";

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

function formatCapacity(attendeeCount: number, maxAttendees: number | null, maybeCount?: number): string {
  const going = maxAttendees ? `${attendeeCount} / ${maxAttendees} going` : `${attendeeCount} going`;
  if (maybeCount) return `${going} · ${maybeCount} maybe`;
  return going;
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
      `👥 ${formatCapacity(e.attendeeCount, e.maxAttendees, e.maybeCount)}`,
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

// Callback: Back button — restore original RSVP buttons
eventsHandler.callbackQuery("rsvp_back", async (ctx) => {
  const upcoming = await eventsService.listUpcoming(5);
  const keyboard = new InlineKeyboard();
  for (const [i, e] of upcoming.entries()) {
    keyboard.text(`RSVP: ${e.title.slice(0, 20)}`, `rsvp:${e.id}`);
    if (i < upcoming.length - 1) keyboard.row();
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
});

// Callback: RSVP button pressed — show status options (private) or deep link (group)
eventsHandler.callbackQuery(/^rsvp:(.+)$/, async (ctx) => {
  const eventId = ctx.match?.[1];
  if (!eventId) {
    await ctx.answerCallbackQuery({ text: "Invalid event.", show_alert: true });
    return;
  }

  const isPrivate = ctx.chat?.type === "private";

  if (isPrivate) {
    const keyboard = new InlineKeyboard()
      .text("✅ Going", `rsvp_status:${eventId}:going`)
      .text("🤔 Maybe", `rsvp_status:${eventId}:maybe`)
      .text("❌ Not Going", `rsvp_status:${eventId}:not_going`)
      .row()
      .text("« Back", "rsvp_back");

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } else {
    const botUsername = env.TELEGRAM_BOT_USERNAME;
    await ctx.answerCallbackQuery({
      url: `https://t.me/${botUsername}?start=rsvp_${eventId}`,
    });
  }
});

// Callback: RSVP status selected — perform the RSVP
eventsHandler.callbackQuery(/^rsvp_status:(.+):(going|maybe|not_going)$/, async (ctx) => {
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
  const status = ctx.match?.[2];
  if (!eventId || !status) {
    await ctx.answerCallbackQuery({ text: "Invalid selection.", show_alert: true });
    return;
  }

  try {
    await eventsService.rsvp(eventId, resolved.user.id, status);
    const fresh = await eventsService.getById(eventId);

    const statusLabels: Record<string, string> = {
      going: "going to",
      maybe: "a maybe for",
      not_going: "not going to",
    };
    const statusEmojis: Record<string, string> = {
      going: "✅",
      maybe: "🤔",
      not_going: "❌",
    };

    await ctx.answerCallbackQuery({ text: `You're ${statusLabels[status]} ${fresh.title}!` });
    await ctx.reply(
      `${statusEmojis[status]} *${escapeMarkdown(resolved.user.name ?? "You")}* is ${statusLabels[status]} *${escapeMarkdown(fresh.title)}*\n👥 ${formatCapacity(fresh.attendeeCount, fresh.maxAttendees)}`,
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
