import { Elysia } from "elysia";
import { loginCodeQuerySchema } from "@community-os/shared/validators";

export const authModel = new Elysia({ name: "model.auth" }).model({
  "auth.loginCodeQuery": loginCodeQuerySchema,
});
