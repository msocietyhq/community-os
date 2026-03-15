import { randomBytes } from "node:crypto";
import type { TelegramUser } from "../bot/lib/auth";
import { computeTelegramHash } from "../bot/lib/auth";
import { auth } from "../auth";
import { env } from "../env";

interface LoginCodeEntry {
  telegramUser: TelegramUser;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const codes = new Map<string, LoginCodeEntry>();

// Periodic cleanup of expired codes
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes) {
    if (now > entry.expiresAt) codes.delete(code);
  }
}, 60_000);

export const loginLinkService = {
  /**
   * Generate a one-time auto-login link for a Telegram user.
   * The link expires after 5 minutes and can only be used once.
   */
  createLoginLink(telegramUser: TelegramUser): string {
    const code = randomBytes(32).toString("hex");
    codes.set(code, {
      telegramUser,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    return `${env.BETTER_AUTH_URL}/api/v1/bot/login?code=${code}`;
  },

  /**
   * Exchange a one-time code for a redirect Response with session cookies set.
   * Calls Better Auth's telegram sign-in handler to get proper Set-Cookie headers,
   * then redirects to the given URL.
   */
  async exchangeCode(
    code: string,
    redirectTo: string,
  ): Promise<Response | null> {
    const entry = codes.get(code);
    if (!entry) return null;

    codes.delete(code);
    if (Date.now() > entry.expiresAt) return null;

    const { telegramUser } = entry;

    // Build Telegram auth payload with HMAC (same as getBotToken)
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

    // Call Better Auth handler directly to get proper Set-Cookie headers
    const authRequest = new Request(
      `${env.BETTER_AUTH_URL}/api/auth/sign-in/telegram`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, hash }),
      },
    );
    const authResponse = await auth.handler(authRequest);

    // Build redirect response with session cookies from Better Auth
    const headers = new Headers();
    headers.set("Location", redirectTo);
    for (const cookie of authResponse.headers.getSetCookie()) {
      headers.append("Set-Cookie", cookie);
    }

    return new Response(null, { status: 302, headers });
  },
};
