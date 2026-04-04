import { Elysia } from "elysia";
import { aiUsageQuerySchema } from "@community-os/shared/validators";

export const botModel = new Elysia({ name: "model.bot" }).model({
  "bot.usageQuery": aiUsageQuerySchema,
});
