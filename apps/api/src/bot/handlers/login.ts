import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { loginLinkService } from "../../services/login-link.service";
import { telegramUserFromContext } from "../lib/telegram-user";

export const loginHandler = new Composer<BotContext>();

loginHandler.command("login", async (ctx) => {
  if (ctx.chat.type !== "private") {
    await ctx.reply("Please use this command in a private chat with me.");
    return;
  }

  if (!ctx.from) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  const telegramUser = await telegramUserFromContext(ctx.from, ctx.api);
  const link = loginLinkService.createLoginLink(telegramUser);

  const keyboard = new InlineKeyboard().url("Login to MSOCIETY", link);

  await ctx.reply("Tap the button below to open the portal (expires in 5 minutes):", {
    reply_markup: keyboard,
  });
});
