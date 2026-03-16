import { eq, and } from "drizzle-orm";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types";
import { getBotToken, resolveUser } from "./auth";
import { membersService } from "../../services/members.service";
import { createAuditEntry } from "../../middleware/audit";
import { db } from "../../db";
import { account } from "../../db/schema/auth";
import { members } from "../../db/schema/members";

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

  console.log(`Auto-register: warmed up ${knownTelegramIds.size} known IDs`);
}

/**
 * grammY middleware that auto-registers group members on first interaction.
 * Skips private chats (users there use /register for guided questionnaire).
 */
export async function autoRegisterMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chatType = ctx.chat?.type;

  // Only run in group/supergroup chats
  if (chatType !== "group" && chatType !== "supergroup") {
    return next();
  }

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
    // Check if user+member already exist in DB
    const existing = await resolveUser(String(telegramId));
    if (existing) {
      knownTelegramIds.add(telegramId);
      return next();
    }

    // Auto-register: create user+account via Better Auth
    await getBotToken({
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
    });

    // Resolve the newly created account to get userId
    const acct = await db
      .select({ userId: account.userId })
      .from(account)
      .where(
        and(
          eq(account.providerId, "telegram"),
          eq(account.accountId, String(telegramId)),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!acct) {
      console.error(
        `Auto-register: failed to resolve account for telegram ID ${telegramId}`,
      );
      return next();
    }

    // Create member record (conflict-safe)
    const { created } = await membersService.createIfNotExists(acct.userId);

    if (created) {
      console.log(
        `Auto-register: created member for @${from.username ?? from.first_name} (telegram ID ${telegramId})`,
      );

      await createAuditEntry({
        entityType: "member",
        entityId: acct.userId,
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
    console.error(`Auto-register: error for telegram ID ${telegramId}:`, error);
  }

  return next();
}
