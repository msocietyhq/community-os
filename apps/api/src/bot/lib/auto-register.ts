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
import {
  chooseWelcomeTemplate,
  renderWelcome,
  type WelcomeVariant,
} from "./welcome-template";

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
 * Greet a member in the group, at most once ever.
 *
 * Both signals funnel through here, so the claim in `claimWelcome` is what
 * keeps a member from being greeted twice when both arrive for the same
 * person.
 */
async function sendWelcome(
  ctx: BotContext,
  from: User,
  userId: string,
  variant: WelcomeVariant,
): Promise<void> {
  // Claimed regardless of whether greetings are enabled, so a member who joins
  // while they're off is not greeted later when they're switched back on. The
  // first-message toggle below is checked after the claim for the same reason:
  // switching it on must not greet a backlog of members who already posted.
  if (!(await membersService.claimWelcome(userId))) return;

  const settings = await getSettings();
  const template = chooseWelcomeTemplate({
    variant,
    enabled: settings["welcome.enabled"],
    firstMessageEnabled: settings["welcome.firstMessageEnabled"],
    newMemberText: settings["welcome.newMemberText"],
    firstMessageText: settings["welcome.firstMessageText"],
  });
  if (template === null) return;

  const text = renderWelcome(template, {
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
 * - Regular messages  → register on first interaction, and greet as a
 *   first-time poster if this is the first we've seen of them
 *
 * The two greetings are deliberately different copy. Only the `chat_member`
 * update actually witnesses a join; a first message means nothing more than
 * that we had no record, which is the normal state of every member who was
 * already in the group before the bot became an admin. `members.welcomedAt`
 * is what keeps the two paths from greeting the same person twice.
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
        await sendWelcome(ctx, telegramUser, userId, "join");
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

      // Reaching here means we had no record of them at all, which is not the
      // same as them being new. Telegram reports joins to an admin bot but
      // says nothing about who was already in the chat when the bot arrived,
      // and membership leaves no trace in our data — only messages do. So the
      // overwhelmingly common case is a member of long standing who simply
      // never posted until now, and greeting them as a fresh joiner reads as
      // the bot not knowing who they are. Hence its own copy, not the join
      // copy. A genuine joiner only lands here if their `chat_member` update
      // was lost (bot offline past Telegram's ~24h update retention, or not an
      // admin at the time), which is rare and reads acceptably either way.
      await sendWelcome(ctx, from, userId, "first_message");
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
