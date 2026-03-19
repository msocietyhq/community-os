import { Composer } from "grammy";
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

  await ctx.reply(
    `Tap the link below to open the portal (expires in 5 minutes):\n\n\`${link}\``,
    { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
  );
});
