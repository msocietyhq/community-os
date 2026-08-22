import { and, eq, inArray } from "drizzle-orm";
import { bot } from "../bot";
import { db } from "../../db";
import { account, user } from "../../db/schema";

/**
 * DMs every admin that the day's spend crossed the alert threshold.
 *
 * Lives in bot/ rather than services/ because it sends Telegram messages.
 * ai.service reaches it through a dynamic import so the service layer keeps no
 * static dependency on the bot.
 */
export async function notifyAdminsOfSpend(
  spentUsd: number,
  thresholdUsd: number,
): Promise<void> {
  const admins = await db
    .select({ telegramId: account.accountId })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(
      and(
        // Same filter resolveUser uses — a member with a non-Telegram account
        // row would otherwise yield an account ID that isn't a chat ID.
        eq(account.providerId, "telegram"),
        inArray(user.role, ["admin", "superadmin"]),
      ),
    );

  const text =
    `⚠️ AI spend today has reached $${spentUsd.toFixed(2)}, ` +
    `past your $${thresholdUsd} alert threshold.\n\n` +
    `Use /settings → Cost to adjust the caps, or pause AI entirely.`;

  for (const admin of admins) {
    if (!admin.telegramId) continue;
    await bot.api.sendMessage(admin.telegramId, text).catch((err) => {
      console.error(`[spend-alert] DM to ${admin.telegramId} failed:`, err);
    });
  }
}
