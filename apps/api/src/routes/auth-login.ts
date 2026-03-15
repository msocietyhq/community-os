import { Elysia } from "elysia";
import { computeTelegramHash, resolveUser } from "../bot/lib/auth";
import { auth } from "../auth";
import { env } from "../env";
import { authModel } from "./models/auth";

export const authLoginRoutes = new Elysia({ prefix: "/api/v1/auth" })
  .use(authModel)
  .post(
    "/telegram-login",
    async ({ body, set }) => {
      // Validate auth_date is within 24 hours
      const now = Math.floor(Date.now() / 1000);
      if (now - body.auth_date > 86400) {
        set.status = 400;
        return { error: "Telegram auth data has expired. Please try again." };
      }

      // Build data record for hash verification (only defined fields)
      const hashData: Record<string, string | number> = {
        auth_date: body.auth_date,
        first_name: body.first_name,
        id: body.id,
      };
      if (body.last_name) hashData.last_name = body.last_name;
      if (body.username) hashData.username = body.username;
      if (body.photo_url) hashData.photo_url = body.photo_url;

      const expected = computeTelegramHash(hashData, env.TELEGRAM_BOT_TOKEN);
      if (body.hash !== expected) {
        set.status = 400;
        return { error: "Invalid Telegram auth data." };
      }

      // Check if user is a registered member
      const resolved = await resolveUser(String(body.id));
      if (!resolved) {
        set.status = 403;
        return {
          error:
            "You must register via @msocietybot first. Send /register to the bot.",
        };
      }

      // Delegate to Better Auth SDK — returns Response with Set-Cookie headers.
      // Body type assertion needed: better-auth-telegram doesn't declare body
      // types in its endpoint definition, but reads them at runtime.
      return auth.api.signInWithTelegram!({
        asResponse: true,
        body: { ...hashData, hash: body.hash },
      } as { asResponse: true });
    },
    {
      body: "auth.telegramLogin",
      detail: {
        tags: ["Auth"],
        summary: "Telegram login (members only)",
        description:
          "Authenticates a Telegram user via the Login Widget. Only users who have completed bot registration can log in.",
      },
    },
  );
