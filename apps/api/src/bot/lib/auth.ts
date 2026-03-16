import { createHmac, createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { account, members, user } from "../../db/schema";
import { auth } from "../../auth";
import { env } from "../../env";
import { createAuditEntry } from "../../middleware/audit";

export interface TelegramUser {
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
 * Resolve a Telegram username to a community-os user.
 */
export async function resolveUserByUsername(username: string) {
  const result = await db
    .select({
      user: user,
      member: members,
    })
    .from(user)
    .innerJoin(members, eq(members.userId, user.id))
    .where(eq(user.telegramUsername, username))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Compute the HMAC hash that Telegram Login Widget uses for verification.
 * This lets us call signInWithTelegram from the bot (trusted context).
 */
export function computeTelegramHash(
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

export interface TelegramSignInResult {
  session: { token: string } | null;
  user: unknown;
}

export interface TelegramSignInWithHeadersResult {
  headers: Headers;
  response: TelegramSignInResult;
}

// The better-auth-telegram plugin types signInWithTelegram as conditional,
// so direct calls lose type info. This typed wrapper avoids `any`.
// Validated against better-auth@1.5.5 / better-auth-telegram@1.5.0.
const signInWithTelegram = auth.api.signInWithTelegram as unknown as (
  opts: { body: Record<string, string | number> },
) => Promise<TelegramSignInResult>;

const signInWithTelegramHeaders = auth.api.signInWithTelegram as unknown as (
  opts: { body: Record<string, string | number>; returnHeaders: true },
) => Promise<TelegramSignInWithHeadersResult>;

export { signInWithTelegramHeaders };

/**
 * Create a user + account record for a Telegram user directly in the DB.
 * Used by bot /register since autoCreateUser is disabled on the plugin.
 * Returns the userId, or the existing userId if the account already exists.
 */
export async function createTelegramUser(
  telegramUser: TelegramUser,
): Promise<string> {
  const userId = randomUUID();
  const name =
    telegramUser.first_name +
    (telegramUser.last_name ? ` ${telegramUser.last_name}` : "");

  // Insert user — unique constraint on telegram_id makes this race-safe
  const [inserted] = await db
    .insert(user)
    .values({
      id: userId,
      name,
      image: telegramUser.photo_url,
      telegramId: String(telegramUser.id),
      telegramUsername: telegramUser.username,
    })
    .onConflictDoNothing({ target: user.telegramId })
    .returning({ id: user.id });

  if (!inserted) {
    // User already exists — look up via account
    const [existing] = await db
      .select({ userId: account.userId })
      .from(account)
      .where(
        and(
          eq(account.providerId, "telegram"),
          eq(account.accountId, String(telegramUser.id)),
        ),
      )
      .limit(1);
    return existing!.userId;
  }

  await db.insert(account).values({
    id: randomUUID(),
    accountId: String(telegramUser.id),
    providerId: "telegram",
    userId: inserted.id,
    telegramId: String(telegramUser.id),
    telegramUsername: telegramUser.username,
  });

  // Mirror Better Auth's databaseHooks.user.create.after (audit entry)
  createAuditEntry({
    entityType: "member",
    entityId: inserted.id,
    action: "create",
    newValue: { id: inserted.id, name, telegramId: String(telegramUser.id) },
  }).catch(console.error);

  return inserted.id;
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
  const result = await signInWithTelegram({ body: { ...data, hash } });

  return result.session?.token ?? null;
}
