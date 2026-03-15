import { Elysia } from "elysia";
import { webhookCallback } from "grammy";
import { bot } from "../bot/bot";
import { env } from "../env";

export const botRoutes = new Elysia({ prefix: "/api/v1/bot" })
  .post(
    "/webhook",
    webhookCallback(bot, "elysia", { secretToken: env.WEBHOOK_SECRET }),
    {
      detail: {
        tags: ["Bot"],
        summary: "Telegram webhook callback",
        description:
          "Receives updates from the Telegram Bot API. Authenticated via the X-Telegram-Bot-Api-Secret-Token header.",
      },
    }
  )
  .get(
    "/health",
    () => ({ status: "ok", bot: "running" }),
    {
      detail: {
        tags: ["Bot"],
        summary: "Bot health check",
      },
    }
  );
