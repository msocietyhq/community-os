import { Elysia } from "elysia";
import { webhookCallback } from "grammy";
import { bot } from "./bot";
import { env } from "./env";

export const app = new Elysia()
  .post("/webhook", webhookCallback(bot, "elysia", { secretToken: env.WEBHOOK_SECRET }))
  .get("/health", () => ({ status: "ok" }))
  .listen(env.PORT);
