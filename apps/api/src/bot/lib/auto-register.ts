import { eq } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types";
import { createTelegramUser, resolveUser } from "./auth";
import { telegramUserFromContext } from "./telegram-user";
import { membersService } from "../../services/members.service";
import { createAuditEntry } from "../../middleware/audit";
import { db } from "../../db";
import { account } from "../../db/schema/auth";
import { members } from "../../db/schema/members";
import { env } from "../../env";

/**
 * In-memory cache of Telegram IDs that are known to have
 * both a user+account AND a member record.
 */
export const knownTelegramIds = new Set<number>();

/**
 * Pre-populate the cache on startup by querying accounts
 * that have a corresponding member record.
 */
export async function warmUpKnownIds(): Promise<void> {
  const rows = await db
    .select({ accountId: account.accountId })
    .from(account)
    .innerJoin(members, eq(members.userId, account.userId))
    .where(eq(account.providerId, "telegram"));

  for (const row of rows) {
    const id = Number(row.accountId);
    if (!Number.isNaN(id)) {
      knownTelegramIds.add(id);
    }
  }

  console.log(`Membership: warmed up ${knownTelegramIds.size} known IDs`);
}

function isActiveStatus(
  status: string,
): status is "member" | "administrator" | "creator" {
  return (
    status === "member" || status === "administrator" || status === "creator"
  );
}

/**
 * Unified membership middleware for group chats.
 *
 * - chat_member join  → create user if new + welcome, or unban + "welcome back"
 * - chat_member leave → ban user
 * - Regular messages   → auto-register on first interaction
 */
export async function membershipMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chatType = ctx.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return next();
  }

  // ── chat_member events: join / leave ──────────────────────────
  if (ctx.chatMember) {
    const { old_chat_member, new_chat_member } = ctx.chatMember;
    const telegramUser = new_chat_member.user;

    if (telegramUser.is_bot) return next();

    const wasActive = isActiveStatus(old_chat_member.status);
    const isActive = isActiveStatus(new_chat_member.status);

    // Leave / Kick
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

      return next();
    }

    // Join
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
          "Set up profile",
          `https://t.me/${botUsername}?start=profile`,
        );

        await ctx.reply(
          `Welcome to MSOCIETY, ${mention}! 👋\n\n` +
            `Would you mind doing a short intro?\n` +
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

    return next();
  }

  // ── Regular messages: auto-register on first interaction ──────
  const from = ctx.from;
  if (!from || from.is_bot) {
    return next();
  }

  const telegramId = from.id;

  // Fast path: already known
  if (knownTelegramIds.has(telegramId)) {
    return next();
  }

  try {
    const existing = await resolveUser(String(telegramId));
    if (existing) {
      knownTelegramIds.add(telegramId);
      return next();
    }

    // Auto-register: create user+account directly in DB
    const telegramUser = await telegramUserFromContext(from, ctx.api);
    const userId = await createTelegramUser(telegramUser);

    // Create member record (conflict-safe)
    const { created } = await membersService.createIfNotExists(userId);

    if (created) {
      console.log(
        `Membership: auto-registered @${from.username ?? from.first_name} (telegram ID ${telegramId})`,
      );

      await createAuditEntry({
        entityType: "member",
        entityId: userId,
        action: "create",
        newValue: {
          source: "auto-register",
          telegramId,
          username: from.username,
          firstName: from.first_name,
        },
      });
    }

    knownTelegramIds.add(telegramId);
  } catch (error) {
    // Don't add to cache on failure — retry on next message
    console.error(
      `Membership: auto-register error for telegram ID ${telegramId}:`,
      error,
    );
  }

  return next();
}
