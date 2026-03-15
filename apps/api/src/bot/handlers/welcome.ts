import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { resolveUser } from "../lib/auth";
import { env } from "../../env";

export const welcomeHandler = new Composer<BotContext>();

welcomeHandler.on("chat_member", async (ctx) => {
  const { new_chat_member } = ctx.chatMember;

  if (new_chat_member.status === "member") {
    const user = new_chat_member.user;
    const name = user.first_name;
    const mention = `<a href="tg://user?id=${user.id}">${name}</a>`;

    const existingUser = await resolveUser(String(user.id));

    if (existingUser) {
      await ctx.reply(`Welcome back, ${mention}! 👋`, {
        parse_mode: "HTML",
      });
    } else {
      const botUsername = env.TELEGRAM_BOT_USERNAME;
      const keyboard = new InlineKeyboard().url(
        "Register",
        `https://t.me/${botUsername}?start=register`,
      );

      await ctx.reply(
        `Welcome to MSOCIETY, ${mention}! 👋\n\n` +
          `Would you mind doing a short intro? The members would love to know:\n` +
          `1. Some background of your academics\n` +
          `2. Your current job/situation\n` +
          `3. Your tech interests/aspirations`,
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
        },
      );
    }
  }
});
