import type { FormattedString } from "@grammyjs/parse-mode";
import type { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";

/**
 * Reply with entity-formatted text.
 *
 * Sends styling as entities rather than a parse mode, so the text goes out
 * exactly as composed. Nothing needs escaping, which means an event title or
 * member name containing `*`, `_`, `[` or `<` cannot break — or silently
 * restyle — a message.
 */
export function replyWith(
  ctx: BotContext,
  message: FormattedString,
  replyMarkup?: InlineKeyboard,
) {
  return ctx.reply(message.text, {
    entities: message.entities,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}
