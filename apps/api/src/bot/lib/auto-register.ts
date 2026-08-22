import { eq } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { NextFunction } from "grammy";
import type { User } from "grammy/types";
import type { BotContext } from "../types";
import { createTelegramUser, resolveUser } from "./auth";
import { telegramUserFromContext } from "./telegram-user";
import { membersService } from "../../services/members.service";
import { createAuditEntry } from "../../middleware/audit";
import { db } from "../../db";
import { account } from "../../db/schema/auth";
import { members } from "../../db/schema/members";
import { env } from "../../env";
import { getSettings } from "../../services/bot-settings.service";
import { renderWelcome } from "./welcome-template";

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
 * Resolve a Telegram user to a community-os user, creating the user, account
 * and member row if this is the first we've seen of them.
 *
 * @returns the user ID, and whether this call is what created them.
 */
async function ensureRegistered(
  from: User,
): Promise<{ userId: string; created: boolean }> {
  const existing = await resolveUser(String(from.id));
  if (existing) return { userId: existing.user.id, created: false };

  const userId = await createTelegramUser(telegramUserFromContext(from));
  const { created } = await membersService.createIfNotExists(userId);

  if (created) {
    await createAuditEntry({
      entityType: "member",
      entityId: userId,
      action: "create",
      newValue: {
        source: "auto-register",
        telegramId: from.id,
        username: from.username,
        firstName: from.first_name,
      },
    });
  }

  return { userId, created };
}

/**
 * Greet a new member in the group, at most once ever.
 *
 * Both join signals funnel through here — the `chat_member` update when the
 * bot is a group admin, and the member's first message when it isn't — so the
 * claim in `claimWelcome` is what keeps a member from being greeted twice when
 * both arrive for the same join.
 */
async function sendWelcome(
  ctx: BotContext,
  from: User,
  userId: string,
): Promise<void> {
  // Claimed regardless of whether greetings are enabled, so a member who joins
  // while they're off is not greeted later when they're switched back on.
  if (!(await membersService.claimWelcome(userId))) return;

  const settings = await getSettings();
  if (!settings["welcome.enabled"]) return;

  const text = renderWelcome(settings["welcome.newMemberText"], {
    telegramId: from.id,
    firstName: from.first_name,
    username: from.username,
  });

  const keyboard = settings["welcome.showProfileButton"]
    ? new InlineKeyboard().url(
        "Set up profile",
        `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=profile`,
      )
    : undefined;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

/**
 * Unified membership middleware for group chats.
 *
 * - chat_member join  → register + welcome, or unban + "welcome back"
 * - chat_member leave → ban user
 * - Regular messages  → register on first interaction, and welcome if this is
 *   the first we've seen of them
 *
 * The message path duplicates the join path's greeting on purpose. Telegram
 * only delivers `chat_member` updates to bots that are administrators of the
 * chat, so if the bot is ever not an admin the join branch goes silent and a
 * first message is the only join signal left. `members.welcomedAt` is what
 * keeps the two paths from greeting the same person twice.
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
      const existing = await resolveUser(String(telegramUser.id));

      // A rejoin is specifically someone we banned when they left. Anyone else
      // who already has a record got it from auto-register on an earlier
      // message, and is not owed a "welcome back".
      if (existing?.user.banned) {
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

        const settings = await getSettings();
        if (settings["welcome.enabled"]) {
          await ctx.reply(
            renderWelcome(settings["welcome.returningText"], {
              telegramId: telegramUser.id,
              firstName: telegramUser.first_name,
              username: telegramUser.username,
            }),
            { parse_mode: "HTML" },
          );
        }

        return next();
      }

      // Register them here rather than waiting for a first message they may
      // never send — this branch used to greet new joiners without creating
      // anything, so a silent joiner stayed invisible to every other feature.
      try {
        const { userId } = await ensureRegistered(telegramUser);
        knownTelegramIds.add(telegramUser.id);
        await sendWelcome(ctx, telegramUser, userId);
      } catch (error) {
        console.error(
          `Membership: join handling failed for telegram ID ${telegramUser.id}:`,
          error,
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
    const { userId, created } = await ensureRegistered(from);
    knownTelegramIds.add(telegramId);

    if (created) {
      console.log(
        `Membership: auto-registered @${from.username ?? from.first_name} (telegram ID ${telegramId})`,
      );

      // Fallback greeting. Telegram only sends `chat_member` updates to bots
      // that are group admins, so when the bot isn't one, a member's first
      // message is the only join signal we ever get. Reaching here means they
      // have no record at all — including no message anywhere in the imported
      // history — so this is genuinely the first time we've seen them.
      await sendWelcome(ctx, from, userId);
    }
  } catch (error) {
    // Don't add to cache on failure — retry on next message
    console.error(
      `Membership: auto-register error for telegram ID ${telegramId}:`,
      error,
    );
  }

  return next();
}
