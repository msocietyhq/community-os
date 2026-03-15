import { Composer } from "grammy";
import type { BotContext } from "../types";

export const welcomeHandler = new Composer<BotContext>();

welcomeHandler.on("chat_member", async (ctx) => {
  const { new_chat_member } = ctx.chatMember;

  if (new_chat_member.status === "member") {
    const user = new_chat_member.user;
    const name = user.first_name;

    await ctx.reply(
      `Welcome to MSOCIETY, ${name}! 👋\n\n` +
        `We're a community of Muslim tech professionals in Singapore.\n\n` +
        `Please introduce yourself — tell us what you do and what you're interested in!\n\n` +
        `Use /register to set up your profile on our community portal.`
    );
  }
});
