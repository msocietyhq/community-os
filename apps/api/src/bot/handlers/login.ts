import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { loginLinkService } from "../../services/login-link.service";

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

  const link = loginLinkService.createLoginLink({
    id: ctx.from.id,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    username: ctx.from.username,
  });

  const keyboard = new InlineKeyboard().url("Login to MSOCIETY", link);

  await ctx.reply("Tap the button below to open the portal (expires in 5 minutes):", {
    reply_markup: keyboard,
  });
});
