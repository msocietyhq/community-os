import { Composer } from "grammy";
import type { BotContext } from "../types";
import { getBotToken } from "../lib/auth";

export const tokenHandler = new Composer<BotContext>();

tokenHandler.command("token", async (ctx) => {
  // Only allow in private chats to avoid leaking tokens
  if (ctx.chat.type !== "private") {
    await ctx.reply("This command only works in a private chat with me.");
    return;
  }

  if (!ctx.from) {
    await ctx.reply("Could not identify your Telegram account.");
    return;
  }

  try {
    const token = await getBotToken({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });

    if (!token) {
      await ctx.reply("Failed to generate token. Please try again.");
      return;
    }

    await ctx.reply(
      `*Your API Bearer Token*\n\n` +
        `\`${token}\`\n\n` +
        `Use this in Scalar or API clients as:\n` +
        `\`Authorization: Bearer ${token}\`\n\n` +
        `Expires in 7 days. Run /token again to generate a new one.`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    console.error("Token generation failed:", err);
    await ctx.reply("Failed to generate token. Please try again later.");
  }
});
