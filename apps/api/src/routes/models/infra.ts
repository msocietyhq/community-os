import { storeResourceSecretSchema } from "@community-os/shared/validators";
import { Elysia } from "elysia";

export const infraModel = new Elysia({ name: "model.infra" }).model({
  "infra.secret.store": storeResourceSecretSchema,
});
