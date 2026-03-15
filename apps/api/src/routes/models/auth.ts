import { Elysia } from "elysia";
import {
  telegramAuthSchema,
  loginCodeQuerySchema,
} from "@community-os/shared/validators";

export const authModel = new Elysia({ name: "model.auth" }).model({
  "auth.telegramLogin": telegramAuthSchema,
  "auth.loginCodeQuery": loginCodeQuerySchema,
});
