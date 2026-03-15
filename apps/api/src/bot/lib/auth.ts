import { createHmac, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { account, members, user } from "../../db/schema";
import { auth } from "../../auth";
import { env } from "../../env";

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/**
 * Resolve a Telegram user ID to a community-os user.
 */
export async function resolveUser(telegramId: string) {
  const result = await db
    .select({
      user: user,
      member: members,
    })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .innerJoin(members, eq(members.userId, user.id))
    .where(
      and(
        eq(account.providerId, "telegram"),
        eq(account.accountId, telegramId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Compute the HMAC hash that Telegram Login Widget uses for verification.
 * This lets us call signInWithTelegram from the bot (trusted context).
 */
function computeTelegramHash(
  data: Record<string, string | number>,
  botToken: string,
): string {
  const secretKey = createHash("sha256").update(botToken).digest();
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");
  return createHmac("sha256", secretKey).update(checkString).digest("hex");
}

/**
 * Create a session for a Telegram user via Better Auth's telegram plugin.
 * Constructs valid Telegram auth data with HMAC and calls signInWithTelegram,
 * which auto-creates the user/account if needed.
 */
export async function getBotToken(
  telegramUser: TelegramUser,
): Promise<string | null> {
  const authDate = Math.floor(Date.now() / 1000);

  const data: Record<string, string | number> = {
    auth_date: authDate,
    first_name: telegramUser.first_name,
    id: telegramUser.id,
  };
  if (telegramUser.last_name) data.last_name = telegramUser.last_name;
  if (telegramUser.username) data.username = telegramUser.username;
  if (telegramUser.photo_url) data.photo_url = telegramUser.photo_url;

  const hash = computeTelegramHash(data, env.TELEGRAM_BOT_TOKEN);

  const result = await auth.api.signInWithTelegram!({
    body: { ...data, hash } as any,
  });

  return result.session?.token ?? null;
}
