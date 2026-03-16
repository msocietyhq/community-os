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

      // Call Better Auth's handler to get a Response with Set-Cookie headers,
      // then extract cookies and body so the response goes through Elysia's
      // CORS middleware instead of being returned as a raw Response.
      const authRequest = new Request(
        `${env.API_URL}/api/auth/sign-in/telegram`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...hashData, hash: body.hash }),
        },
      );
      const authResponse = await auth.handler(authRequest);

      // Forward session cookies from Better Auth
      const cookies = authResponse.headers.getSetCookie();
      if (cookies.length === 1) {
        set.headers["set-cookie"] = cookies[0];
      } else if (cookies.length > 1) {
        (set.headers as Record<string, string | string[]>)["set-cookie"] =
          cookies;
      }

      set.status = authResponse.status;
      return authResponse.json();
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
