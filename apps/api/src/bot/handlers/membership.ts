import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { resolveUser } from "../lib/auth";
import { membersService } from "../../services/members.service";
import { createAuditEntry } from "../../middleware/audit";
import { knownTelegramIds } from "../lib/auto-register";
import { env } from "../../env";

export const membershipHandler = new Composer<BotContext>();

function isActiveStatus(
  status: string,
): status is "member" | "administrator" | "creator" {
  return status === "member" || status === "administrator" || status === "creator";
}

membershipHandler.on("chat_member", async (ctx) => {
  const { old_chat_member, new_chat_member } = ctx.chatMember;
  const telegramUser = new_chat_member.user;

  if (telegramUser.is_bot) return;

  const wasActive = isActiveStatus(old_chat_member.status);
  const isActive = isActiveStatus(new_chat_member.status);

  // Leave / Kick: was active, now inactive
  if (wasActive && !isActive) {
    const existing = await resolveUser(String(telegramUser.id));

    if (existing && !existing.user.banned) {
      await membersService.ban(existing.user.id, { skipTelegram: true });

      knownTelegramIds.delete(telegramUser.id);

      await createAuditEntry({
        entityType: "member",
        entityId: existing.user.id,
        action: "ban",
        performedBy: "system",
        newValue: {
          source: "telegram-group-leave",
          telegramId: telegramUser.id,
          username: telegramUser.username,
          oldStatus: old_chat_member.status,
          newStatus: new_chat_member.status,
        },
      });

      console.log(
        `Membership: deactivated @${telegramUser.username ?? telegramUser.first_name} (left/removed from group)`,
      );
    }

    return;
  }

  // Join: was inactive, now active
  if (!wasActive && isActive) {
    const name = telegramUser.first_name;
    const mention = `<a href="tg://user?id=${telegramUser.id}">${name}</a>`;

    const existing = await resolveUser(String(telegramUser.id));

    if (existing) {
      if (existing.user.banned) {
        await membersService.unban(existing.user.id, { skipTelegram: true });
        knownTelegramIds.add(telegramUser.id);

        await createAuditEntry({
          entityType: "member",
          entityId: existing.user.id,
          action: "unban",
          performedBy: "system",
          newValue: {
            source: "telegram-group-rejoin",
            telegramId: telegramUser.id,
            username: telegramUser.username,
          },
        });

        console.log(
          `Membership: reactivated @${telegramUser.username ?? telegramUser.first_name} (rejoined group)`,
        );
      }

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
